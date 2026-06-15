package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

// getDataDir returns a "ChatData" folder next to the running exe.
// Creates the folder if it does not exist.
func getDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "ChatData"
	}
	dir := filepath.Join(filepath.Dir(exe), "ChatData")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

func main() {
	if len(os.Args) >= 4 && os.Args[1] == "--toast" {
		title := os.Args[2]
		body := os.Args[3]
		target := ""
		if len(os.Args) >= 5 {
			target = os.Args[4]
		}
		runToastInstance(title, body, target)
		return
	}

	// Prevent duplicate instances — show existing window if already running
	ensureSingleInstance()

	// Apply proxy settings before WebView2 starts
	applyProxyFromConfig()

	app := NewApp()

	err := wails.Run(&options.App{
		Title:            "Chat Desktop",
		Width:            1240,
		Height:           860,
		MinWidth:         980,
		MinHeight:        700,
		DisableResize:    false,
		Frameless:        false,
		StartHidden:      hasStartupMinimizedArg(),
		HideWindowOnClose: true,
		EnableDefaultContextMenu: true,
		BackgroundColour: &options.RGBA{R: 240, G: 242, B: 245, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnBeforeClose: app.beforeClose,
		Bind: []interface{}{
			app,
		},
		// Windows-specific options
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               getDataDir(),
			Theme:                             windows.SystemDefault,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

func runToastInstance(title, body, target string) {
	app := NewApp()
	app.isToastMode = true
	app.toastTitle = title
	app.toastBody = body
	app.toastTarget = target

	err := wails.Run(&options.App{
		Title:            "Notification",
		Width:            320,
			Height:           110,
		DisableResize:    true,
		Frameless:        true,
		StartHidden:      true,
		AlwaysOnTop:      true,
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: func(ctx context.Context) {
			app.ctx = ctx

			screens, err := runtime.ScreenGetAll(ctx)
			if err == nil && len(screens) > 0 {
				position := getSavedToastPosition()
				x := screens[0].Size.Width - 340
				y := screens[0].Size.Height - 150
				switch position {
				case "top-left":
					x = 20
					y = 20
				case "top-right":
					x = screens[0].Size.Width - 340
					y = 20
				case "bottom-left":
					x = 20
					y = screens[0].Size.Height - 150
				default: // bottom-right
					x = screens[0].Size.Width - 340
					y = screens[0].Size.Height - 150
				}
				runtime.WindowSetPosition(ctx, x, y)
			}
			runtime.WindowShow(ctx)

			// Auto close after 5 seconds
			go func() {
				time.Sleep(5 * time.Second)
				runtime.Quit(ctx)
			}()
		},
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               true,
			DisableWindowIcon:                 true,
			DisableFramelessWindowDecorations: true,
			Theme:                             windows.Dark,
		},
	})

	if err != nil {
		fmt.Println("Error:", err.Error())
	}
}
