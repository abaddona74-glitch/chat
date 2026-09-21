package main

import (
	"crypto/sha256"
	"encoding/json"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	AppVersion = "2.0.8"
	UpdateURL  = "https://mytelegramchat.ddns.net"
)



// UpdateInfo represents the update check response
type UpdateInfo struct {
	Update  bool   `json:"update"`
	Version string `json:"version"`
	Notes   string `json:"notes"`
}

type UpdateHistoryItem struct {
	Version    string `json:"version"`
	Notes      string `json:"notes"`
	ReleasedAt string `json:"releasedAt"`
	IsLatest   bool   `json:"isLatest"`
}

type UpdateHistoryResponse struct {
	Versions []UpdateHistoryItem `json:"versions"`
}

// CheckForUpdate checks the server for a new version
func (a *App) CheckForUpdate() map[string]interface{} {
	client := &http.Client{Timeout: 10 * time.Second}
	checkURL := fmt.Sprintf("%s/update/check?ts=%d", UpdateURL, time.Now().UnixMilli())
	req, err := http.NewRequest(http.MethodGet, checkURL, nil)
	if err != nil {
		return map[string]interface{}{"available": false, "error": err.Error()}
	}
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{"available": false, "error": err.Error()}
	}
	defer resp.Body.Close()

	var info UpdateInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return map[string]interface{}{"available": false, "error": err.Error()}
	}

	serverVersion := strings.TrimSpace(info.Version)

	if !info.Update || serverVersion == "" {
		return map[string]interface{}{"available": false, "currentVersion": AppVersion}
	}

	// Compare versions
	if compareVersions(serverVersion, AppVersion) <= 0 {
		return map[string]interface{}{"available": false, "currentVersion": AppVersion}
	}

	return map[string]interface{}{
		"available":      true,
		"currentVersion": AppVersion,
		"newVersion":     serverVersion,
		"notes":          info.Notes,
	}
}

// GetUpdateHistory returns all desktop update versions stored on the server.
func (a *App) GetUpdateHistory() map[string]interface{} {
	client := &http.Client{Timeout: 10 * time.Second}
	historyURL := fmt.Sprintf("%s/update/history?ts=%d", UpdateURL, time.Now().UnixMilli())
	req, err := http.NewRequest(http.MethodGet, historyURL, nil)
	if err != nil {
		return map[string]interface{}{"versions": []UpdateHistoryItem{}}
	}
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{"versions": []UpdateHistoryItem{}}
	}
	defer resp.Body.Close()

	var history UpdateHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&history); err != nil {
		return map[string]interface{}{"versions": []UpdateHistoryItem{}}
	}

	if history.Versions == nil {
		history.Versions = []UpdateHistoryItem{}
	}

	return map[string]interface{}{"versions": history.Versions}
}

// DownloadAndUpdate downloads the selected exe and prepares for restart.
func (a *App) DownloadAndUpdate(version string, allowSameVersion bool) map[string]interface{} {
	client := &http.Client{Timeout: 5 * time.Minute}
	downloadURL := fmt.Sprintf("%s/update/download?ts=%d", UpdateURL, time.Now().UnixMilli())
	if selectedVersion := strings.TrimSpace(version); selectedVersion != "" {
		downloadURL = fmt.Sprintf("%s&version=%s", downloadURL, url.QueryEscape(selectedVersion))
	}
	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := client.Do(req)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return map[string]interface{}{"success": false, "error": fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}

	// Download to temp file next to current exe
	exeDir := filepath.Dir(a.exePath)
	currentExe := a.exePath
	currentProc := filepath.Base(currentExe)
	primaryExe := filepath.Join(exeDir, "ChatDesktop.exe")
	primaryProc := filepath.Base(primaryExe)
	tmpFile := filepath.Join(exeDir, "ChatDesktop_update.exe")
	oldFile := filepath.Join(exeDir, "ChatDesktop_old.exe")

	out, err := os.Create(tmpFile)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "Temp fayl yaratib bo'lmadi: " + err.Error()}
	}

	// Download with progress reporting (non-blocking, throttled)
	totalSize := resp.ContentLength
	var downloaded int64
	buf := make([]byte, 256*1024) // 256KB buffer for speed
	startTime := time.Now()
	lastEmitTime := time.Now()
	var lastEmitBytes int64
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := out.Write(buf[:n])
			if writeErr != nil {
				out.Close()
				os.Remove(tmpFile)
				return map[string]interface{}{"success": false, "error": "Yozishda xatolik: " + writeErr.Error()}
			}
			downloaded += int64(n)
			if totalSize > 0 && time.Since(lastEmitTime) > 300*time.Millisecond {
				percent := int(downloaded * 100 / totalSize)
				elapsedSec := time.Since(lastEmitTime).Seconds()
				deltaBytes := downloaded - lastEmitBytes
				speedMbps := 0.0
				if elapsedSec > 0 && deltaBytes > 0 {
					speedMbps = (float64(deltaBytes) * 8) / elapsedSec / 1_000_000
				}
				go wailsRuntime.EventsEmit(a.ctx, "update:progress", map[string]interface{}{
					"percent":   percent, "totalMB": float64(totalSize)/1_048_576,
					"speedMbps": speedMbps,
				})
				lastEmitTime = time.Now()
				lastEmitBytes = downloaded
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			out.Close()
			os.Remove(tmpFile)
			return map[string]interface{}{"success": false, "error": "Yuklab olishda xatolik: " + readErr.Error()}
		}
	}
	// Final 100% emit
	elapsedSec := time.Since(startTime).Seconds()
	finalSpeedMbps := 0.0
	if elapsedSec > 0 {
		finalSpeedMbps = (float64(downloaded) * 8) / elapsedSec / 1_000_000
	}
	go wailsRuntime.EventsEmit(a.ctx, "update:progress", map[string]interface{}{
		"percent":   100, "totalMB": float64(totalSize)/1_048_576,
		"speedMbps": finalSpeedMbps,
	})
	out.Close()

	currentHash, currentErr := fileSHA256(currentExe)
	tmpHash, tmpErr := fileSHA256(tmpFile)
	if !allowSameVersion && currentErr == nil && tmpErr == nil && currentHash == tmpHash {
		os.Remove(tmpFile)
		return map[string]interface{}{
			"success": false,
			"error":   "Update fayl hozirgi versiya bilan bir xil. Serverdagi exe yangilanmagan bo'lishi mumkin.",
		}
	}

	// Create a batch script to replace the exe and restart
	batScript := fmt.Sprintf(`@echo off
timeout /t 3 /nobreak >nul
:waitloop
set RUNNING=0
tasklist /fi "imagename eq %s" 2>nul | find /i "%s" >nul
if not errorlevel 1 set RUNNING=1
tasklist /fi "imagename eq %s" 2>nul | find /i "%s" >nul
if not errorlevel 1 set RUNNING=1
if "%%RUNNING%%"=="1" (
	timeout /t 1 /nobreak >nul
	goto waitloop
)
timeout /t 2 /nobreak >nul
if exist "%s" del /f /q "%s"
:trymove
move /y "%s" "%s"
if errorlevel 1 (
	timeout /t 1 /nobreak >nul
	goto trymove
)
if /I not "%s"=="%s" copy /y "%s" "%s" >nul
start "" "%s"
del "%%~f0"
`, currentProc, currentProc, primaryProc, primaryProc, oldFile, oldFile, tmpFile, currentExe, currentExe, currentExe, primaryExe, currentExe, currentExe)

	batFile := filepath.Join(exeDir, "_update_runner.bat")
	if err := os.WriteFile(batFile, []byte(batScript), 0755); err != nil {
		os.Remove(tmpFile)
		return map[string]interface{}{"success": false, "error": "Bat fayl yaratib bo'lmadi: " + err.Error()}
	}

	// Run the batch file and exit
	cmd := exec.Command("cmd", "/c", batFile)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		os.Remove(tmpFile)
		os.Remove(batFile)
		return map[string]interface{}{"success": false, "error": "Update scriptni ishga tushirib bo'lmadi: " + err.Error()}
	}

	// Exit the app so the bat can replace the exe
	a.isUpdating = true
	go func() {
		time.Sleep(1 * time.Second)
		if a.ctx != nil {
			wailsRuntime.Quit(a.ctx)
		}
		// Fallback if Quit didn't work
		time.Sleep(2 * time.Second)
		os.Exit(0)
	}()

	return map[string]interface{}{"success": true}
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// GetAppVersionInfo returns the current app version
func (a *App) GetAppVersionInfo() string {
	return AppVersion
}

// compareVersions returns 1 if a > b, -1 if a < b, 0 if equal
func compareVersions(a, b string) int {
	partRegex := regexp.MustCompile(`\d+`)
	parsePart := func(part string) int {
		match := partRegex.FindString(part)
		if match == "" {
			return 0
		}
		var n int
		fmt.Sscanf(match, "%d", &n)
		return n
	}

	aParts := strings.Split(a, ".")
	bParts := strings.Split(b, ".")

	maxLen := len(aParts)
	if len(bParts) > maxLen {
		maxLen = len(bParts)
	}

	for i := 0; i < maxLen; i++ {
		aNum, bNum := 0, 0
		if i < len(aParts) {
			aNum = parsePart(aParts[i])
		}
		if i < len(bParts) {
			bNum = parsePart(bParts[i])
		}
		if aNum > bNum {
			return 1
		}
		if aNum < bNum {
			return -1
		}
	}
	return 0
}

