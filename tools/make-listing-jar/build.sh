#!/bin/sh
# Builds observatory-2.0.0.jar, the fictional demo jar of the listing images. Run it in a JDK 21
# container (tools/make-listing-samples.sh does, on the PC):
#   docker run --rm -v "$PWD":/w -w /w eclipse-temurin:21-jdk sh build.sh
# demo.observatory is a module of 9 packages compiled for Java 21, except util/Units: the base
# class is compiled for Java 8 and META-INF/versions/17 holds its Java 17 build (Multi-Release).
set -eu
cd "$(dirname "$0")"
rm -rf build observatory-2.0.0.jar
mkdir -p build/classes build/units8 build/units17

# Everything for Java 21, against the Java 17 Units (it has the same public API as the base).
javac --release 21 -encoding UTF-8 -g -parameters -d build/classes \
  $(find src -name '*.java' | sort) src17/demo/observatory/util/Units.java
javac --release 8 -Xlint:-options -encoding UTF-8 -g -d build/units8 src8/demo/observatory/util/Units.java
javac --release 17 -encoding UTF-8 -g -d build/units17 src17/demo/observatory/util/Units.java
cp build/units8/demo/observatory/util/Units.class build/classes/demo/observatory/util/Units.class

jar --create --file observatory-2.0.0.jar --manifest MANIFEST.MF \
  --main-class demo.observatory.Main --module-version 2.0.0 \
  -C build/classes . --release 17 -C build/units17 .
jar --describe-module --file observatory-2.0.0.jar
echo "classes: $(jar --list --file observatory-2.0.0.jar | grep -c '\.class$')"
