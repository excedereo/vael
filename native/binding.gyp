{
  "targets": [{
    "target_name": "console_window",
    "sources": ["src/console_window.cc"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")"
    ],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "conditions": [
      ["OS=='win'", {
        "libraries": ["user32.lib", "kernel32.lib"],
        "msvs_settings": {
          "VCCLCompilerTool": {
            "ExceptionHandling": 0,
            "AdditionalOptions": ["/std:c++17"]
          }
        }
      }]
    ]
  }]
}
