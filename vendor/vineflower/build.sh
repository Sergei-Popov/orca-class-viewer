#!/bin/sh
# Rebuilds vf.runtime.js, the JavaScript build of the Vineflower decompiler, from glue/ in a pinned
# container. glue/ is katana-project/vf at 97ce2aae (MIT) with TeaVM's obfuscation turned off; it
# compiles Vineflower 1.12.0 from Maven Central with TeaVM 0.15.0-dev-6. Needs Docker and the
# network (Maven Central, the Gradle plugin portal and teavm.org's Maven repository). The result
# works the same as the committed file but is not byte-for-byte equal: see BUILD.md.
set -eu

IMAGE='gradle:9.5.1-jdk21@sha256:b1210616becadef85acbafeeb09b44bb64f4b982f3d876e7621341125ae3c431'
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -R "$here/glue/." "$work/"
docker run --rm -u "$(id -u):$(id -g)" -v "$work:/w" -w /w -e GRADLE_USER_HOME=/w/.gradle-home \
  "$IMAGE" gradle --no-daemon --quiet generateJavaScript
cp "$work/build/generated/teavm/js/vf.js" "$here/vf.runtime.js"
echo "wrote $here/vf.runtime.js ($(wc -c < "$here/vf.runtime.js") bytes)"
