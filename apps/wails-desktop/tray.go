package main

import (
	_ "embed"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/tray.ico
var trayIconBytes []byte

// setupTray creates the system tray icon with context menu
func (a *App) setupTray() {
	systray.SetIcon(trayIconBytes)
	systray.SetTitle("Chat Desktop")
	systray.SetTooltip("Chat Desktop")

	mOpen := systray.AddMenuItem("Chat'ni ochish", "Oynani ko'rsatish")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Chiqish", "Dasturdan chiqish")

	// Keep default single-click behavior so right-click context menu stays reliable on Windows.
	systray.SetOnDClick(func(menu systray.IMenu) {
		runtime.WindowShow(a.ctx)
	})

	mOpen.Click(func() {
		runtime.WindowShow(a.ctx)
	})
	mQuit.Click(func() {
		a.closeToTray = false
		systray.Quit()
		runtime.Quit(a.ctx)
	})
}
