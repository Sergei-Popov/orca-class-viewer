# Vineflower for Class File Viewer

Prepared for a later version (0.2.0) that adds full decompilation behind `src/decompiler/`.
Nothing in the plugin loads these files yet.

## What is here

| Path                   | What it is                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `vf.runtime.js`        | Vineflower 1.12.0 compiled to JavaScript by TeaVM, **not obfuscated**: readable code with Java-derived names. An ES module that exports `decompile(names, options)`; `glue/vf.d.ts` describes it. No `eval`, `new Function` or network calls. |
| `glue/`                | The sources of [katana-project/vf](https://github.com/katana-project/vf) (formerly run-slicer/vf), MIT, at commit `97ce2aae9f517954d4221150e0ffe5d9568b51ea`, the commit behind npm `@run-slicer/vf` 0.6.4-1.12.0. One change: `obfuscated = false` for both TeaVM targets in `build.gradle.kts`. Left out: `gradle/wrapper/gradle-wrapper.jar` (a binary) and the `gradlew` scripts that need it; `build.sh` uses a pinned Gradle image instead. |
| `vineflower-1.12.0/`   | The sources of [Vineflower](https://github.com/Vineflower/vineflower) 1.12.0, Apache-2.0, tag `1.12.0` = commit `b8273988af850e8cfb234ca08d129058502b032f`: `src/` and `plugins/*/src/main/` with the licence and README. Left out: tests, test data and `plugins/kotlin/libs/metadata.jar` (a binary; see below). |
| `build.sh`             | Rebuilds `vf.runtime.js` from `glue/` in a pinned container.               |

## How `vf.runtime.js` is built

```sh
vendor/vineflower/build.sh     # needs Docker and the network; under a minute with a warm image
```

The script copies `glue/` to a temporary folder and runs `gradle generateJavaScript` in
`gradle:9.5.1-jdk21@sha256:b1210616becadef85acbafeeb09b44bb64f4b982f3d876e7621341125ae3c431`
(Gradle 9.5.1, the glue's wrapper version, with JDK 21). Gradle fetches:

- `org.vineflower:vineflower:1.12.0` from Maven Central: the jar built from the tag above,
  with its plugins (Kotlin, Scala, IDEA not-null, variable renaming) inside;
- TeaVM 0.15.0-dev-6 (Apache-2.0), a development build from `https://teavm.org/maven/repository`
  that is not on Maven Central. TeaVM's Java class library is compiled into `vf.runtime.js`
  along with Vineflower; its sources are not vendored here
  ([konsoletyper/teavm](https://github.com/konsoletyper/teavm)).

The committed file was built this way on 2026-11-15 with the glue's own Gradle wrapper in
`eclipse-temurin:21-jdk@sha256:0a3f329821dcadf54b2a3033a15e2e9f007069a9db43d7f51897e6b80e726b07`:
6,251,377 bytes, SHA-256 `53a3711be662ca3b51cbb5e4d8a129a7b389852345eaae597b6bd390b82c3394`.

## Not reproducible to the byte

TeaVM's output is not deterministic: two clean builds of the same commit in the same pinned
container differ, and neither equals the file on npm. `build.sh` therefore gives a file that
works the same but has another SHA-256. Checked on 2026-11-15: `build.sh` (48 s, empty Gradle
cache) wrote 6,251,367 bytes, SHA-256
`6f1dcb4869f480d8a60531c608d5c9664aaf6cb53f96db5357a8e1b71cbba09f`; `diff` against the committed
file reports 1,588 changed lines of 126,566. Both files decompiled the same test classes to
identical Java source in Node 24. Making TeaVM deterministic is upstream work.

## Kotlin metadata

Vineflower's Kotlin plugin reads `@Metadata` with JetBrains' Kotlin metadata library
(Apache-2.0), which its source tree keeps as `plugins/kotlin/libs/metadata.jar`. That jar is a
binary and is not committed; the Maven Central jar that the build uses already contains it.
The glue replaces four of its protobuf builder classes (`glue/src/main/java/org/vineflower/kt/`)
so that TeaVM can compile them.

## Licences

See `LICENSES.md`.
