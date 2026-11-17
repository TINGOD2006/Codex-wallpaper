using System;
using System.Runtime.InteropServices;

public static class CodexNativeActivation {
    public const string WallpaperArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0";
    const uint LocalServer = 4;
    const uint NoErrorUI = 2;
    const int ChangedApartment = unchecked((int)0x80010106);

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint apartment);
    [DllImport("ole32.dll")] static extern void CoUninitialize();
    [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context,
        ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out Manager manager);
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Manager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint pid);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr items, out uint pid);
    }
    public static uint Activate(string id, IntPtr foreground) {
        if (foreground != IntPtr.Zero && GetForegroundWindow() != foreground) return 0;
        int initialized = CoInitializeEx(IntPtr.Zero, 0);
        if (initialized != ChangedApartment) Marshal.ThrowExceptionForHR(initialized);
        try {
            var classId = new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c");
            var interfaceId = typeof(Manager).GUID;
            Manager manager;
            Marshal.ThrowExceptionForHR(CoCreateInstance(ref classId, IntPtr.Zero, LocalServer, ref interfaceId, out manager));
            try {
                if (foreground != IntPtr.Zero && GetForegroundWindow() != foreground) return 0;
                // Activation can launch a new process if the previous instance is exiting.
                uint pid;
                Marshal.ThrowExceptionForHR(manager.ActivateApplication(id, WallpaperArguments, NoErrorUI, out pid));
                return pid;
            } finally { Marshal.ReleaseComObject(manager); }
        } finally { if (initialized >= 0) CoUninitialize(); }
    }
}
