#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <napi.h>
#include <string>
#include <thread>
#include <atomic>

// Embedded conhost process + SetParent embedding

struct ConsoleHandle {
  HANDLE hJob = nullptr;
  PROCESS_INFORMATION pi = {};
  HWND hwndConsole = nullptr;
  HWND hwndParent = nullptr;
};

static ConsoleHandle g_con;
static std::atomic<bool> g_spawned(false);

// Find the console window spawned by a given process
static HWND FindConsoleWindowForProcess(DWORD pid, int maxWaitMs = 3000) {
  HWND found = nullptr;
  int waited = 0;
  while (!found && waited < maxWaitMs) {
    Sleep(50);
    waited += 50;
    // Enumerate all top-level windows and find one owned by pid
    struct EnumCtx { DWORD pid; HWND result; };
    EnumCtx ctx = { pid, nullptr };
    EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
      auto* c = reinterpret_cast<EnumCtx*>(lp);
      DWORD wpid = 0;
      GetWindowThreadProcessId(hwnd, &wpid);
      if (wpid == c->pid && IsWindowVisible(hwnd)) {
        // Check it's a console window (class "ConsoleWindowClass")
        char cls[64] = {};
        GetClassNameA(hwnd, cls, sizeof(cls));
        if (strcmp(cls, "ConsoleWindowClass") == 0) {
          c->result = hwnd;
          return FALSE;
        }
      }
      return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));
    found = ctx.result;
  }
  return found;
}

// Spawn: spawn conhost + claude, embed into parent HWND
// Args: parentHwnd (string/number), sessionPath (string), x, y, w, h
Napi::Value Spawn(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 6) {
    Napi::TypeError::New(env, "Expected: parentHwnd, sessionPath, x, y, w, h").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Kill previous if any
  if (g_spawned.load()) {
    if (g_con.hwndConsole && IsWindow(g_con.hwndConsole)) {
      // Restore parent before destroying
      SetParent(g_con.hwndConsole, nullptr);
      ShowWindow(g_con.hwndConsole, SW_HIDE);
    }
    if (g_con.pi.hProcess) {
      TerminateProcess(g_con.pi.hProcess, 0);
      CloseHandle(g_con.pi.hProcess);
      CloseHandle(g_con.pi.hThread);
    }
    if (g_con.hJob) {
      CloseHandle(g_con.hJob);
    }
    g_con = {};
    g_spawned.store(false);
  }

  // Parent HWND — passed as string (HWND is 64-bit on x64)
  HWND parentHwnd = nullptr;
  if (info[0].IsString()) {
    std::string s = info[0].As<Napi::String>().Utf8Value();
    parentHwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(s)));
  } else if (info[0].IsNumber()) {
    parentHwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value()));
  }

  std::string sessionPath = info[1].As<Napi::String>().Utf8Value();
  int x = info[2].As<Napi::Number>().Int32Value();
  int y = info[3].As<Napi::Number>().Int32Value();
  int w = info[4].As<Napi::Number>().Int32Value();
  int h = info[5].As<Napi::Number>().Int32Value();

  // Build command: cmd.exe /k "claude --resume <path>"
  // We use cmd.exe so the console window exists independently of claude process lifecycle
  std::string cmd = "cmd.exe /k \"claude --dangerously-skip-permissions --resume \\\"" + sessionPath + "\\\"\"";
  std::vector<char> cmdBuf(cmd.begin(), cmd.end());
  cmdBuf.push_back(0);

  // Job object — auto-kill child when parent dies
  g_con.hJob = CreateJobObjectA(nullptr, nullptr);
  if (g_con.hJob) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {};
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(g_con.hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
  }

  STARTUPINFOA si = {};
  si.cb = sizeof(si);

  // CREATE_NEW_CONSOLE so cmd.exe gets its own console window
  BOOL ok = CreateProcessA(
    nullptr, cmdBuf.data(), nullptr, nullptr, FALSE,
    CREATE_NEW_CONSOLE, nullptr, nullptr, &si, &g_con.pi
  );

  if (!ok) {
    DWORD err = GetLastError();
    Napi::Error::New(env, "CreateProcess failed: " + std::to_string(err)).ThrowAsJavaScriptException();
    return env.Null();
  }

  if (g_con.hJob) {
    AssignProcessToJobObject(g_con.hJob, g_con.pi.hProcess);
  }

  g_spawned.store(true);
  g_con.hwndParent = parentHwnd;

  // Find console window in background thread, then do SetParent + move
  DWORD pid = g_con.pi.dwProcessId;

  // We do this synchronously with a timeout — called from main process, not renderer
  HWND hwndCon = FindConsoleWindowForProcess(pid, 5000);
  if (!hwndCon) {
    return Napi::Boolean::New(env, false);
  }
  g_con.hwndConsole = hwndCon;

  // Strip console window decorations
  LONG style = GetWindowLong(hwndCon, GWL_STYLE);
  style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZE | WS_MAXIMIZE | WS_SYSMENU);
  style |= WS_CHILD;
  SetWindowLong(hwndCon, GWL_STYLE, style);

  LONG exStyle = GetWindowLong(hwndCon, GWL_EXSTYLE);
  exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE);
  SetWindowLong(hwndCon, GWL_EXSTYLE, exStyle);

  // Embed into Electron window
  SetParent(hwndCon, parentHwnd);
  SetWindowPos(hwndCon, HWND_TOP, x, y, w, h, SWP_SHOWWINDOW | SWP_FRAMECHANGED);

  return Napi::Boolean::New(env, true);
}

// Move/resize the embedded console window
Napi::Value Move(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_con.hwndConsole || !IsWindow(g_con.hwndConsole)) {
    return Napi::Boolean::New(env, false);
  }
  int x = info[0].As<Napi::Number>().Int32Value();
  int y = info[1].As<Napi::Number>().Int32Value();
  int w = info[2].As<Napi::Number>().Int32Value();
  int h = info[3].As<Napi::Number>().Int32Value();
  SetWindowPos(g_con.hwndConsole, HWND_TOP, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
  return Napi::Boolean::New(env, true);
}

// Kill the embedded console process
Napi::Value Kill(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_spawned.load()) return Napi::Boolean::New(env, false);

  if (g_con.hwndConsole && IsWindow(g_con.hwndConsole)) {
    SetParent(g_con.hwndConsole, nullptr);
    ShowWindow(g_con.hwndConsole, SW_HIDE);
  }
  if (g_con.pi.hProcess) {
    TerminateProcess(g_con.pi.hProcess, 0);
    CloseHandle(g_con.pi.hProcess);
    CloseHandle(g_con.pi.hThread);
  }
  if (g_con.hJob) CloseHandle(g_con.hJob);
  g_con = {};
  g_spawned.store(false);
  return Napi::Boolean::New(env, true);
}

// Check if console window is still alive
Napi::Value IsAlive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_spawned.load()) return Napi::Boolean::New(env, false);
  if (!g_con.hwndConsole || !IsWindow(g_con.hwndConsole)) return Napi::Boolean::New(env, false);
  DWORD code = 0;
  if (!GetExitCodeProcess(g_con.pi.hProcess, &code)) return Napi::Boolean::New(env, false);
  return Napi::Boolean::New(env, code == STILL_ACTIVE);
}

// Show/hide the embedded window
Napi::Value SetVisible(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool visible = info[0].As<Napi::Boolean>().Value();
  if (g_con.hwndConsole && IsWindow(g_con.hwndConsole)) {
    ShowWindow(g_con.hwndConsole, visible ? SW_SHOW : SW_HIDE);
  }
  return env.Undefined();
}

// Read file paths from clipboard (CF_HDROP)
Napi::Value GetClipboardFiles(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  if (!OpenClipboard(nullptr)) return result;

  HGLOBAL hDrop = GetClipboardData(CF_HDROP);
  if (!hDrop) { CloseClipboard(); return result; }

  HDROP hDropData = (HDROP)GlobalLock(hDrop);
  if (!hDropData) { CloseClipboard(); return result; }

  UINT count = DragQueryFileW(hDropData, 0xFFFFFFFF, nullptr, 0);
  for (UINT i = 0; i < count; i++) {
    UINT len = DragQueryFileW(hDropData, i, nullptr, 0);
    std::wstring wpath(len, L'\0');
    DragQueryFileW(hDropData, i, &wpath[0], len + 1);
    // Convert wide string to UTF-8
    int utf8len = WideCharToMultiByte(CP_UTF8, 0, wpath.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string utf8path(utf8len - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wpath.c_str(), -1, &utf8path[0], utf8len, nullptr, nullptr);
    result.Set(i, Napi::String::New(env, utf8path));
  }

  GlobalUnlock(hDrop);
  CloseClipboard();
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("spawn",             Napi::Function::New(env, Spawn));
  exports.Set("move",              Napi::Function::New(env, Move));
  exports.Set("kill",              Napi::Function::New(env, Kill));
  exports.Set("isAlive",           Napi::Function::New(env, IsAlive));
  exports.Set("setVisible",        Napi::Function::New(env, SetVisible));
  exports.Set("getClipboardFiles", Napi::Function::New(env, GetClipboardFiles));
  return exports;
}

NODE_API_MODULE(console_window, Init)
