package main

import (
	"fmt"
	"net/http"
)

func rootHandler(w http.ResponseWriter, _ *http.Request) {
	fmt.Fprintln(w, "{{name}} is running")
}

func main() {
	http.HandleFunc("/", rootHandler)
	fmt.Println("{{name}} listening on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		panic(err)
	}
}
