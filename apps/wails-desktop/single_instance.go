package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	user32          = syscall.NewLazyDLL("user32.dll")
	createMutexW    = kernel32.NewProc("CreateMutexW")
	findWindowW     = user32.NewProc("FindWindowW")
	showWindow      = user32.NewProc("ShowWindow")
	setForeground   = user32.NewProc("SetForegroundWindow")
)

const (
	ERROR_ALREADY_EXISTS = 183
	SW_RESTORE           = 9
)

var singleInstanceMutex uintptr

// ensureSingleInstance prevents duplicate app instances.
// If another instance is already running, it brings its window to front and exits.
func ensureSingleInstance() {
	for _, arg := range os.Args {
		if arg == "--multi-instance" {
			return
		}
	}

	mutexName, _ := syscall.UTF16PtrFromString("ChatDesktop_SingleInstance_Mutex")
	h, _, err := createMutexW.Call(0, 0, uintptr(unsafe.Pointer(mutexName)))

	if err.(syscall.Errno) == ERROR_ALREADY_EXISTS {
		// Another instance is running — try to find and activate its window
		className, _ := syscall.UTF16PtrFromString("wails-default-window")
		windowTitle, _ := syscall.UTF16PtrFromString("Chat Desktop")

		hwnd, _, _ := findWindowW.Call(
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(windowTitle)),
		)

		if hwnd != 0 {
			showWindow.Call(hwnd, SW_RESTORE)
			setForeground.Call(hwnd)
		} else {
			// Try just by title
			hwnd2, _, _ := findWindowW.Call(0, uintptr(unsafe.Pointer(windowTitle)))
			if hwnd2 != 0 {
				showWindow.Call(hwnd2, SW_RESTORE)
				setForeground.Call(hwnd2)
			}
		}

		fmt.Println("Chat Desktop is already running.")
		os.Exit(0)
	}
	singleInstanceMutex = h
}

// releaseSingleInstanceMutex releases the mutex so a new instance can start
func releaseSingleInstanceMutex() {
	if singleInstanceMutex != 0 {
		closeHandle := kernel32.NewProc("CloseHandle")
		closeHandle.Call(singleInstanceMutex)
		singleInstanceMutex = 0
	}
}
