#!/bin/sh
# Writes the demo files of the listing images into .orca/listing/samples/ (git-ignored):
# observatory-2.0.0.jar, built from tools/make-listing-jar/ in eclipse-temurin:21-jdk on a
# Docker host reachable by ssh (the Mac has no JDK). The jar and its classes are never committed.
#   tools/make-listing-samples.sh            # host "pc": ssh pc, docker --context pc
#   LISTING_DOCKER_HOST=other tools/make-listing-samples.sh
set -eu
cd "$(dirname "$0")/.."
host=${LISTING_DOCKER_HOST:-pc}
remote=$(ssh "$host" 'mkdir -p tmp/observatory && cd tmp/observatory && pwd')
uid=$(ssh "$host" 'id -u'):$(ssh "$host" 'id -g')
rsync -a --delete --exclude build/ --exclude '*.jar' tools/make-listing-jar/ "$host:$remote/"
docker --context "$host" run --rm -u "$uid" -v "$remote:/w" -w /w eclipse-temurin:21-jdk sh build.sh
mkdir -p .orca/listing/samples
scp -q "$host:$remote/observatory-2.0.0.jar" .orca/listing/samples/
ls -l .orca/listing/samples/observatory-2.0.0.jar
