# Licences of the vendored Vineflower build

| Part                                              | Licence     | Text                              |
| ------------------------------------------------- | ----------- | --------------------------------- |
| Vineflower 1.12.0 (`vineflower-1.12.0/`, and compiled into `vf.runtime.js`) | Apache-2.0 | `vineflower-1.12.0/LICENSE.md` |
| The glue, katana-project/vf (`glue/`, and compiled into `vf.runtime.js`)     | MIT        | `glue/LICENSE`                 |
| TeaVM's Java class library and runtime (compiled into `vf.runtime.js`)       | Apache-2.0 | `glue/LICENSE-VF` (the same Apache License 2.0 text) |
| JetBrains' Kotlin metadata library (inside the Maven Central jar the build uses, compiled into `vf.runtime.js`) | Apache-2.0 | `glue/LICENSE-VF` (the same Apache License 2.0 text) |

Vineflower is a fork of Fernflower by JetBrains, also Apache-2.0. Class File Viewer itself is
MIT (the `LICENSE` at the plugin root) and is independent; not affiliated with the Vineflower
project, the TeaVM project, katana-project or JetBrains.
