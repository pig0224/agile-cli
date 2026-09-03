.PHONY: build test run lint

build:
	go build -o bin/{{name}} ./...

test:
	go test ./... -v

run:
	go run .

lint:
	go vet ./...
