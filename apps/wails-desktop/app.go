package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

var (
	// user32 is declared in single_instance.go
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procSetWindowPos             = user32.NewProc("SetWindowPos")

	winmm         = syscall.NewLazyDLL("winmm.dll")
	procPlaySound = winmm.NewProc("PlaySoundW")
	dwmapi                  = syscall.NewLazyDLL("dwmapi.dll")
	procDwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
	xmlEscaper    = strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
)

// App struct - main backend, all methods exposed to React frontend
type App struct {
	ctx         context.Context
	closeToTray bool
	launchMinimizedOnStartup bool
	appName     string
	exePath     string
	isToastMode bool
	isUpdating  bool
	toastTitle  string
	toastBody   string
	toastTarget string
}

func hasStartupMinimizedArg() bool {
	for _, arg := range os.Args[1:] {
		if arg == "--startup-minimized" {
			return true
		}
	}
	return false
}

func (a *App) startupCommand() string {
	if a.launchMinimizedOnStartup {
		return fmt.Sprintf(`"%s" --startup-minimized`, a.exePath)
	}
	return fmt.Sprintf(`"%s"`, a.exePath)
}

// NewApp creates a new App application struct
func NewApp() *App {
	exe, _ := os.Executable()
	return &App{
		closeToTray:              true,
		launchMinimizedOnStartup: hasStartupMinimizedArg(),
		appName:                  "ChatDesktop",
		exePath:                  exe,
	}
}

// GetToastData returns toast context to frontend
func (a *App) GetToastData() map[string]interface{} {
	return map[string]interface{}{
		"isToast": a.isToastMode,
		"title":   a.toastTitle,
		"body":    a.toastBody,
		"target":  a.toastTarget,
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.isToastMode {
		return
	}
	// Start system tray in background
	go systray.Run(a.setupTray, nil)
	go a.applyWindowCaptionTheme()
	if a.launchMinimizedOnStartup {
		runtime.WindowHide(ctx)
	}
}

func parseHexToColorRef(hex string, fallback uint32) uint32 {
	trimmed := strings.TrimSpace(strings.TrimPrefix(hex, "#"))
	if len(trimmed) != 6 {
		return fallback
	}

	raw, err := strconv.ParseUint(trimmed, 16, 32)
	if err != nil {
		return fallback
	}

	r := uint32((raw >> 16) & 0xFF)
	g := uint32((raw >> 8) & 0xFF)
	b := uint32(raw & 0xFF)
	return (b << 16) | (g << 8) | r
}

func findMainWindowHandle() uintptr {
	className, _ := syscall.UTF16PtrFromString("wails-default-window")
	title, _ := syscall.UTF16PtrFromString("Chat Desktop")
	hwnd, _, _ := findWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
	)
	if hwnd == 0 {
		hwnd, _, _ = findWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	}
	return hwnd
}

// applyWindowCaptionTheme paints native Windows title bar to match app dark UI.
func (a *App) applyWindowCaptionTheme() {
	_ = a.SetWindowCaptionTheme("#1e2c3a", "#e1e8ef", true)
}

// SetWindowCaptionTheme updates native Windows title bar colors to match active app theme.
func (a *App) SetWindowCaptionTheme(captionHex string, textHex string, useDarkMode bool) bool {
	const (
		dwmwaUseImmersiveDarkMode = 20
		dwmwaCaptionColor         = 35
		dwmwaTextColor            = 36
	)

	captionColor := parseHexToColorRef(captionHex, 0x003A2C1E)
	textColor := parseHexToColorRef(textHex, 0x00EFE8E1)
	darkMode := int32(0)
	if useDarkMode {
		darkMode = 1
	}

	for i := 0; i < 20; i++ {
		hwnd := findMainWindowHandle()
		if hwnd == 0 {
			time.Sleep(120 * time.Millisecond)
			continue
		}

		_, _, _ = procDwmSetWindowAttribute.Call(
			hwnd,
			uintptr(dwmwaUseImmersiveDarkMode),
			uintptr(unsafe.Pointer(&darkMode)),
			unsafe.Sizeof(darkMode),
		)

		_, _, _ = procDwmSetWindowAttribute.Call(
			hwnd,
			uintptr(dwmwaCaptionColor),
			uintptr(unsafe.Pointer(&captionColor)),
			unsafe.Sizeof(captionColor),
		)

		_, _, _ = procDwmSetWindowAttribute.Call(
			hwnd,
			uintptr(dwmwaTextColor),
			uintptr(unsafe.Pointer(&textColor)),
			unsafe.Sizeof(textColor),
		)

		return true
	}

	return false
}

// beforeClose is called when the user tries to close the window
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.isToastMode {
		return false
	}
	if a.isUpdating {
		return false // allow close during update
	}
	if a.closeToTray {
		runtime.WindowHide(ctx)
		return true // prevent close, hide instead
	}
	return false
}

// GetStartupEnabled checks if the app is set to run on Windows startup
func (a *App) GetStartupEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Run`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()

	_, _, err = k.GetStringValue(a.appName)
	return err == nil
}

// SetStartupEnabled enables or disables auto-start on Windows login.
// When launchMinimized is true, the startup entry includes a flag so the app
// can start hidden in the tray without flashing a window.
func (a *App) SetStartupEnabled(enabled bool, launchMinimized bool) bool {
	a.launchMinimizedOnStartup = launchMinimized
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return a.GetStartupEnabled()
	}
	defer k.Close()

	if enabled {
		err = k.SetStringValue(a.appName, a.startupCommand())
	} else {
		err = k.DeleteValue(a.appName)
	}

	if err != nil {
		return a.GetStartupEnabled()
	}
	return enabled
}

// SetStartupLaunchMinimized controls whether auto-start launches the app hidden.
func (a *App) SetStartupLaunchMinimized(enabled bool) bool {
	a.launchMinimizedOnStartup = enabled
	if !a.GetStartupEnabled() {
		return enabled
	}
	return a.SetStartupEnabled(true, enabled)
}

// Notify sends a notification event to the frontend
func (a *App) Notify(title string, body string) bool {
	runtime.EventsEmit(a.ctx, "native-notification", map[string]string{
		"title": title,
		"body":  body,
	})
	return true
}

// IsWindowFocused returns whether the main window is currently focused
func (a *App) IsWindowFocused() bool {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return false
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	return pid == uint32(os.Getpid())
}

// MinimizeToTray hides the main window (minimize to system tray)
func (a *App) MinimizeToTray() bool {
	runtime.WindowHide(a.ctx)
	return true
}

// ShowWindow brings the window back from tray
func (a *App) ShowWindow() {
	runtime.WindowShow(a.ctx)
}

// FocusMainWindow restores and focuses the primary Chat Desktop window.
// Useful when user clicks the separate toast popup instance.
func (a *App) FocusMainWindow() bool {
	className, _ := syscall.UTF16PtrFromString("wails-default-window")
	title, _ := syscall.UTF16PtrFromString("Chat Desktop")
	hwnd, _, _ := findWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
	)
	if hwnd == 0 {
		hwnd, _, _ = findWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	}
	if hwnd == 0 {
		return false
	}

	showWindow.Call(hwnd, 9) // SW_RESTORE
	setForeground.Call(hwnd)
	return true
}

// SetCloseToTray enables or disables the "close to tray" behavior
func (a *App) SetCloseToTray(enabled bool) bool {
	a.closeToTray = enabled
	return a.closeToTray
}

// GetCloseToTray returns the current close-to-tray setting
func (a *App) GetCloseToTray() bool {
	return a.closeToTray
}

// BringToFrontForCall shows and focuses the main window for incoming calls.
// It intentionally does not set always-on-top so Alt+Tab works normally.
// OpenDevTools simulates Ctrl+Shift+I to open WebView2 DevTools.
// Requires build with `wails build -debug`.
func (a *App) OpenDevTools() bool {
	className, _ := syscall.UTF16PtrFromString("wails-default-window")
	title, _ := syscall.UTF16PtrFromString("Chat Desktop")
	hwnd, _, _ := findWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
	)
	if hwnd == 0 {
		hwnd, _, _ = findWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	}
	if hwnd == 0 {
		return false
	}
	setForeground.Call(hwnd)
	keybdEvent := user32.NewProc("keybd_event")
	const (
		keyEventDown = 0x0000
		keyEventUp   = 0x0002
		vkF12        = 0x7B
		vkControl    = 0x11
		vkShift      = 0x10
		vkI          = 0x49
	)
	// Wails v2 debug build: F12 toggles DevTools.
	keybdEvent.Call(uintptr(vkF12), 0, keyEventDown, 0)
	time.Sleep(20 * time.Millisecond)
	keybdEvent.Call(uintptr(vkF12), 0, keyEventUp, 0)
	time.Sleep(40 * time.Millisecond)
	// Also try Ctrl+Shift+I as fallback (some WebView2 builds)
	keybdEvent.Call(uintptr(vkControl), 0, keyEventDown, 0)
	keybdEvent.Call(uintptr(vkShift), 0, keyEventDown, 0)
	keybdEvent.Call(uintptr(vkI), 0, keyEventDown, 0)
	time.Sleep(20 * time.Millisecond)
	keybdEvent.Call(uintptr(vkI), 0, keyEventUp, 0)
	keybdEvent.Call(uintptr(vkShift), 0, keyEventUp, 0)
	keybdEvent.Call(uintptr(vkControl), 0, keyEventUp, 0)
	return true
}

func (a *App) BringToFrontForCall() bool {
	runtime.WindowShow(a.ctx)
	// Use Windows API directly for reliable foreground restore.
	className, _ := syscall.UTF16PtrFromString("wails-default-window")
	title, _ := syscall.UTF16PtrFromString("Chat Desktop")
	hwnd, _, _ := findWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
	)
	if hwnd == 0 {
		// fallback: try by title only
		hwnd, _, _ = findWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	}
	if hwnd != 0 {
		showWindow.Call(hwnd, 9) // SW_RESTORE
		setForeground.Call(hwnd)
	}
	return true
}

// RestoreNormalWindow removes the always-on-top flag so the window behaves
// normally again (call accepted / declined / ended).
func (a *App) RestoreNormalWindow() bool {
	className, _ := syscall.UTF16PtrFromString("wails-default-window")
	title, _ := syscall.UTF16PtrFromString("Chat Desktop")
	hwnd, _, _ := findWindowW.Call(
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
	)
	if hwnd == 0 {
		hwnd, _, _ = findWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	}
	if hwnd != 0 {
		const (
			HWND_NOTOPMOST = ^uintptr(1) // -2
			SWP_NOMOVE     = 0x0002
			SWP_NOSIZE     = 0x0001
		)
		procSetWindowPos.Call(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
			SWP_NOMOVE|SWP_NOSIZE)
	}
	return true
}

// ShowCallNotif emits an event to show incoming call UI in React
func (a *App) ShowCallNotif(callerName string) bool {
	runtime.EventsEmit(a.ctx, "call-notif:show", callerName)
	return true
}

// HideCallNotif emits an event to hide the call notification UI
func (a *App) HideCallNotif() bool {
	runtime.EventsEmit(a.ctx, "call-notif:hide")
	return true
}

// CallNotifRespond handles accept/decline from the call notification
func (a *App) CallNotifRespond(action string) bool {
	runtime.EventsEmit(a.ctx, "call-notif:action", action)
	runtime.WindowShow(a.ctx)
	return true
}

// GetAppVersion returns the application version
func (a *App) GetAppVersion() string {
	return AppVersion
}

// PlayNotificationSound plays the Windows system notification sound
func (a *App) PlayNotificationSound() bool {
	soundName, _ := syscall.UTF16PtrFromString("SystemNotification")
	// SND_ALIAS (0x00010000) | SND_ASYNC (0x0001)
	procPlaySound.Call(
		uintptr(unsafe.Pointer(soundName)),
		0,
		0x00010001,
	)
	return true
}

func escapePSQuoted(input string) string {
	return strings.ReplaceAll(input, "'", "''")
}

func escapeXML(input string) string {
	return xmlEscaper.Replace(input)
}

// ShowOSNotification shows a native Windows toast notification.
// Falls back to legacy tray balloon-tip if toast API is unavailable.
func (a *App) ShowOSNotification(title string, body string) bool {
	safeTitle := escapePSQuoted(title)
	safeBody := escapePSQuoted(body)
	safeExe := escapePSQuoted(a.exePath)
	safeToastTitle := escapeXML(title)
	safeToastBody := escapeXML(body)

	ps := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$toastShown = $false
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
    $xml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>%s</text>
      <text>%s</text>
    </binding>
  </visual>
	<audio silent="true" />
</toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
    # Use PowerShell AppID for unpackaged desktop apps.
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Windows PowerShell").Show($toast)
    $toastShown = $true
} catch {
    $toastShown = $false
}

if (-not $toastShown) {
 [void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
 [void][System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')
 $n = New-Object System.Windows.Forms.NotifyIcon
 $exePath = '%s'
 if (Test-Path $exePath) {
     $n.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
 } else {
     $n.Icon = [System.Drawing.SystemIcons]::Information
 }
 $n.BalloonTipIcon  = 'Info'
 $n.BalloonTipTitle = '%s'
 $n.BalloonTipText  = '%s'
 $n.Visible = $true
 $n.ShowBalloonTip(5000)
 Start-Sleep -Milliseconds 5500
 $n.Visible = $false
 $n.Dispose()
}
 `, safeToastTitle, safeToastBody, safeExe, safeTitle, safeBody)

	// Write to a unique temp .ps1 file and execute it in background.
	tmp, err := os.CreateTemp("", "chatdesktop_notif_*.ps1")
	if err != nil {
		return false
	}
	tmpFile := tmp.Name()
	if _, err := tmp.WriteString(ps); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpFile)
		return false
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpFile)
		return false
	}

	cmd := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", tmpFile)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	go func() {
		_ = cmd.Run()
		_ = os.Remove(tmpFile)
	}()
	return true
}

// ShowCustomToast spawns a new instance of the app in toast mode
func (a *App) ShowCustomToast(title string, body string) bool {
	return a.ShowCustomToastWithTarget(title, body, "")
}

// ShowCustomToastWithTarget spawns a toast popup with serialized target payload.
// target is expected to be a JSON string containing chatMode/userId/groupId.
func (a *App) ShowCustomToastWithTarget(title string, body string, target string) bool {
	// Execute self with --toast
	cmd := exec.Command(a.exePath, "--toast", title, body, target)
	err := cmd.Start()
	if err != nil {
		fmt.Println("Failed to start toast process:", err)
		return a.ShowOSNotification(title, body) // fallback
	}
	// Do not wait for it, let it draw and die
	return true
}

// SetPendingNotificationTarget stores notification target payload for the main app.
func (a *App) SetPendingNotificationTarget(target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	return os.WriteFile(pendingNotificationTargetPath(), []byte(target), 0644) == nil
}

// ConsumePendingNotificationTarget returns and clears pending notification target payload.
func (a *App) ConsumePendingNotificationTarget() string {
	path := pendingNotificationTargetPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	_ = os.Remove(path)
	return strings.TrimSpace(string(data))
}

// FileExistsInDownloads checks if a file already exists in ChatData/downloads
func (a *App) FileExistsInDownloads(fileName string) bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	savePath := filepath.Join(filepath.Dir(exe), "ChatData", "downloads", fileName)
	_, err = os.Stat(savePath)
	return err == nil
}

// GetDownloadPath returns full path of a file in ChatData/downloads
func (a *App) GetDownloadPath(fileName string) string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "ChatData", "downloads", fileName)
}

// ShowInExplorer opens Windows Explorer and selects the file
func (a *App) ShowInExplorer(filePath string) bool {
	cmd := exec.Command("explorer", "/select,", filePath)
	err := cmd.Start()
	return err == nil
}

// SaveFileFromURL downloads a file from URL and saves to ChatData/downloads folder, returns the saved path
func (a *App) SaveFileFromURL(fileURL string, fileName string) string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	downloadsDir := filepath.Join(filepath.Dir(exe), "ChatData", "downloads")
	os.MkdirAll(downloadsDir, 0755)

	savePath := filepath.Join(downloadsDir, fileName)
	// If file already exists, return it immediately (no re-download)
	if _, err := os.Stat(savePath); err == nil {
		return savePath
	}

	resp, err := http.Get(fileURL)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	out, err := os.Create(savePath)
	if err != nil {
		return ""
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return ""
	}
	return savePath
}

// GetGeoLocation uses the Windows Location Platform (same as Chrome) to get
// accurate GPS / Wi-Fi triangulation coordinates.
// Returns {"latitude": float64, "longitude": float64, "accuracy": float64}
// or {"error": "message"} when location is unavailable.
func (a *App) GetGeoLocation() map[string]interface{} {
	// PowerShell script that uses .NET System.Device.Location (Windows Location Platform).
	// Falls back to WinRT Geolocator if System.Device is not available.
	script := `$ErrorActionPreference = 'Stop'
$lat = $null; $lon = $null; $acc = $null

# --- Attempt 1: System.Device.Location (uses Windows Location Platform) ---
try {
    [void][Reflection.Assembly]::LoadWithPartialName('System.Device')
    $w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
    $w.Start()
    $max = 100; $i = 0
    while ($w.Status -ne 'Ready' -and $i -lt $max) { Start-Sleep -Milliseconds 100; $i++ }
    $c = $w.Position.Location
    $w.Stop()
    if ($c -and !$c.IsUnknown) {
        $lat = $c.Latitude; $lon = $c.Longitude; $acc = $c.HorizontalAccuracy
    }
} catch {}

# --- Attempt 2: WinRT Geolocator ---
if ($null -eq $lat) {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $astMethods = [System.WindowsRuntimeSystemExtensions].GetMethods() |
            Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + `1' }
        $ast = $astMethods[0]
        [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
        $gl = New-Object Windows.Devices.Geolocation.Geolocator
        $gl.DesiredAccuracyInMeters = [uint32]10
        $op = $gl.GetGeopositionAsync()
        $task = $ast.MakeGenericMethod([Windows.Devices.Geolocation.Geoposition]).Invoke($null, @($op))
        [void]$task.Wait(15000)
        $pos = $task.Result
        $lat = $pos.Coordinate.Point.Position.Latitude
        $lon = $pos.Coordinate.Point.Position.Longitude
        $acc = $pos.Coordinate.Accuracy
    } catch {}
}

if ($null -ne $lat) {
    Write-Output "$lat|$lon|$acc"
} else {
    Write-Output "UNKNOWN"
}
`
	tmp, err := os.CreateTemp("", "chatdesktop_geo_*.ps1")
	if err != nil {
		return map[string]interface{}{"error": "cannot create temp file"}
	}
	tmpFile := tmp.Name()
	_, _ = tmp.WriteString(script)
	_ = tmp.Close()
	defer os.Remove(tmpFile)

	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmpFile)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("powershell error: %v", err)}
	}

	result := strings.TrimSpace(string(out))
	if result == "UNKNOWN" || result == "" {
		return map[string]interface{}{"error": "Windows Location service unavailable. Enable Location in Windows Settings > Privacy > Location."}
	}

	parts := strings.Split(result, "|")
	if len(parts) < 2 {
		return map[string]interface{}{"error": "unexpected response: " + result}
	}

	lat, err1 := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	lng, err2 := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err1 != nil || err2 != nil {
		return map[string]interface{}{"error": "parse error: " + result}
	}

	acc := 0.0
	if len(parts) > 2 {
		acc, _ = strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
	}

	return map[string]interface{}{
		"latitude":  lat,
		"longitude": lng,
		"accuracy":  acc,
	}
}

// ProxyConfig holds the proxy settings
type ProxyConfig struct {
	Enabled bool   `json:"enabled"`
	Type    string `json:"type"`    // "http", "socks5"
	Host    string `json:"host"`
	Port    string `json:"port"`
}

type ToastConfig struct {
	Position string `json:"position"`
}

func normalizeToastPosition(position string) string {
	switch strings.ToLower(strings.TrimSpace(position)) {
	case "top-left", "top-right", "bottom-left", "bottom-right":
		return strings.ToLower(strings.TrimSpace(position))
	default:
		return "bottom-right"
	}
}

func toastConfigPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "toast.json"
	}
	dir := filepath.Join(filepath.Dir(exe), "ChatData")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "toast.json")
}

func pendingNotificationTargetPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "pending_notification_target.json"
	}
	dir := filepath.Join(filepath.Dir(exe), "ChatData")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "pending_notification_target.json")
}

func getSavedToastPosition() string {
	data, err := os.ReadFile(toastConfigPath())
	if err != nil {
		return "bottom-right"
	}
	var cfg ToastConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return "bottom-right"
	}
	return normalizeToastPosition(cfg.Position)
}

// GetToastPosition returns current toast popup corner.
func (a *App) GetToastPosition() string {
	return getSavedToastPosition()
}

// SetToastPosition saves toast popup corner. Allowed values:
// top-left, top-right, bottom-left, bottom-right.
func (a *App) SetToastPosition(position string) bool {
	cfg := ToastConfig{Position: normalizeToastPosition(position)}
	data, err := json.Marshal(cfg)
	if err != nil {
		return false
	}
	return os.WriteFile(toastConfigPath(), data, 0644) == nil
}

func proxyConfigPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "proxy.json"
	}
	dir := filepath.Join(filepath.Dir(exe), "ChatData")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "proxy.json")
}

// GetProxyConfig returns the saved proxy configuration
func (a *App) GetProxyConfig() ProxyConfig {
	data, err := os.ReadFile(proxyConfigPath())
	if err != nil {
		return ProxyConfig{}
	}
	var cfg ProxyConfig
	_ = json.Unmarshal(data, &cfg)
	return cfg
}

// SaveProxyConfig saves proxy settings and returns true on success
func (a *App) SaveProxyConfig(cfg ProxyConfig) bool {
	data, err := json.Marshal(cfg)
	if err != nil {
		return false
	}
	err = os.WriteFile(proxyConfigPath(), data, 0644)
	return err == nil
}

// RestartApp restarts the application
func (a *App) RestartApp() bool {
	// Release single-instance mutex so the new process can start
	releaseSingleInstanceMutex()
	cmd := exec.Command(a.exePath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	if err := cmd.Start(); err != nil {
		return false
	}
	os.Exit(0)
	return true
}

// applyProxyFromConfig reads saved proxy config and sets WebView2 env var.
// Must be called BEFORE wails.Run().
func applyProxyFromConfig() {
	data, err := os.ReadFile(proxyConfigPath())
	if err != nil {
		return
	}
	var cfg ProxyConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}
	if !cfg.Enabled || cfg.Host == "" || cfg.Port == "" {
		return
	}
	var proxyURL string
	switch cfg.Type {
	case "socks5":
		proxyURL = "socks5://" + cfg.Host + ":" + cfg.Port
	case "http":
		proxyURL = "http://" + cfg.Host + ":" + cfg.Port
	default:
		proxyURL = cfg.Host + ":" + cfg.Port
	}
	existing := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
	arg := "--proxy-server=" + proxyURL
	if existing != "" {
		arg = existing + " " + arg
	}
	os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", arg)
	fmt.Println("[Proxy] Applied:", proxyURL)
}

// FetchPublicIp fetches the public IP, using proxy if configured
func (a *App) FetchPublicIp() map[string]interface{} {
	cfg := a.GetProxyConfig()

	var client *http.Client
	if cfg.Enabled && cfg.Host != "" && cfg.Port != "" {
		var proxyURL string
		switch cfg.Type {
		case "socks5":
			proxyURL = "socks5://" + cfg.Host + ":" + cfg.Port
		default:
			proxyURL = "http://" + cfg.Host + ":" + cfg.Port
		}
		parsed, err := url.Parse(proxyURL)
		if err != nil {
			return map[string]interface{}{"error": "Invalid proxy URL: " + err.Error()}
		}
		transport := &http.Transport{
			Proxy: http.ProxyURL(parsed),
			DialContext: (&net.Dialer{
				Timeout: 10 * time.Second,
			}).DialContext,
		}
		client = &http.Client{Transport: transport, Timeout: 15 * time.Second}
	} else {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	resp, err := client.Get("https://api.ipify.org?format=json")
	if err != nil {
		return map[string]interface{}{"error": "Request failed: " + err.Error()}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{"error": "Read failed: " + err.Error()}
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return map[string]interface{}{"ip": strings.TrimSpace(string(body))}
	}
	return result
}

// GetAppliedProxy returns the currently applied proxy info for debugging
func (a *App) GetAppliedProxy() string {
	return os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
}
