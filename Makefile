PROTOC ?= protoc

setup_env_mac:
	brew install protobuf
	npm i ts-protoc-gen -g

clean:
	./node_modules/.bin/rimraf dist
	./node_modules/.bin/rimraf dist-web
	./node_modules/.bin/rimraf dist-cjs

compile_protocol:
	cd proto; ${PROTOC} --js_out=import_style=commonjs_strict,binary:. --ts_out=. ./broker.proto
	echo 'exports.default = proto;' >> ./proto/broker_pb.js

build: | clean compile_protocol
	./node_modules/.bin/tsc -p tsconfig.json
	./node_modules/.bin/tsc -p tsconfig.cjs.json
	./node_modules/.bin/rollup -c --environment BUILD:production
	./node_modules/.bin/rollup -c

test: build-signaling
	./node_modules/.bin/mocha dist-cjs/tests/*.js --timeout 30000

build-signaling: build
	npm link
	cd beakman-signaling; npm i
	cd beakman-signaling; npm link beakman
	cd beakman-signaling; npm test

update-signaling:
	git submodule update --init --recursive
	git submodule foreach git pull origin master

.PHONY: build clean