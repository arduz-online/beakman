PROTOC ?= protoc
VERSION = 3.11.4

install_mac: install
	brew install protobuf

install_ubuntu: install
	# sudo apt install protobuf-compiler
	# Just consolidated the whole process by considering other comments

	# Make sure you grab the latest version
	curl -OL https://github.com/protocolbuffers/protobuf/releases/download/v$(VERSION)/protoc-$(VERSION)-linux-x86_64.zip

	# Unzip
	unzip protoc-$(VERSION)-linux-x86_64.zip -d protoc3

	# Move protoc to /usr/local/bin/
	sudo cp -r protoc3/bin/* /usr/local/bin/

	# Move protoc3/include to /usr/local/include/
	sudo cp -r protoc3/include/* /usr/local/include/

  # delete the files
	rm protoc-$(VERSION)-linux-x86_64.zip
	rm -rf protoc3

install:
	npm i ts-protoc-gen -g

clean:
	rm -rf dist || true
	rm -rf dist-web || true
	rm -rf dist-cjs || true
	npm install

compile_protocol:
	${PROTOC} --js_out=import_style=commonjs_strict,binary:. --ts_out=. --proto_path=. ./proto/broker.proto
	echo 'exports.default = proto;' >> ./proto/broker_pb.js

build: | clean compile_protocol
	./node_modules/.bin/tsc -p tsconfig.json
	./node_modules/.bin/tsc -p tsconfig.cjs.json
	./node_modules/.bin/rollup -c --environment BUILD:production
	./node_modules/.bin/rollup -c
	cp dist-web/beakman.min.js docs/beakman.min.js

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