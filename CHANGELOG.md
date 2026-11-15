# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-plugin.sh` in the hub turns
`[Unreleased]` into the released version.

## [Unreleased]

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
  of resources and an overview with the Java versions of the classes, the module and the
  manifest. Entries are taken as the JVM takes them (by stored name, the last copy winning);
  unusual names and shadowed copies are listed apart, with a notice.
- Clear messages for newer, damaged, cut-off and misnamed files and for damaged attributes;
  obfuscated names shown with escapes.
- Find, Copy and Save…; keyboard navigation of the tree.
- English and Russian, following Orca's language; Orca's light and dark themes.
