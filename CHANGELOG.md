# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-plugin.sh` in the hub turns
`[Unreleased]` into the released version.

## [Unreleased]

## [0.1.0] - 2026-11-15

### Added

- `.class` files open in Class File Viewer by default, with four tabs: **Outline** (the
  declarations in Java syntax, with links to each method's bytecode and, in a jar, to the
  classes it names), **Bytecode** (listed like `javap -c -v`), **Structure** (the class file's
  header, members and attributes, each with its offset, length and bytes) and **Constant pool**
  (filterable, cross-linked, with what uses each entry).
- A **Java N** badge for the release a class was compiled for, and badges for classes compiled
  by Kotlin (with its `@Metadata` version in Structure), Scala, Groovy or Clojure.
- `.jmod` files open by default, and `.jar`, `.war`, `.ear` and `.aar` files as an option, in a
  browser of packages and classes: nested classes under their outer class, class roots of web
  and Spring Boot archives, multi-release versions, archives inside opened in place, previews
  of resources and an overview with the Java versions of the classes, the module (a `.jmod`'s
  too) and the manifest. Entries are taken as the JVM takes them: the central directory
  `java.util.zip` reads, by stored name, the last copy winning, and the manifest and version
  folders as Java 21 finds them. Unusual names, shadowed copies and entries named like folders
  that hold data are listed apart, with a notice; so is an archive with a second directory.
- Clear messages for newer, damaged, cut-off and misnamed files and for damaged attributes;
  obfuscated names shown with escapes. Code longer than the JVM allows is shown as damaged, and
  the Bytecode tab lists up to a million instructions and table rows, with a notice past that.
- Find, Copy and Save…; keyboard navigation of the tree.
- English and Russian, following Orca's language; Orca's light and dark themes.
