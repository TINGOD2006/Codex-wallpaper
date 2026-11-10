using System;
using System.Runtime.InteropServices;

public static class CodexNativeActivation {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Manager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint pid);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr items, out uint pid);
    }
    public static uint Activate(string id, IntPtr foreground) {
        if (foreground != IntPtr.Zero && GetForegroundWindow() != foreground) return 0;
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45ba127d-10a8-46ea-8ab7-56ea9078943c")));
        try {
            uint pid;
            Marshal.ThrowExceptionForHR(((Manager)instance).ActivateApplication(id, null, 2, out pid));
            return pid;
        } finally { Marshal.ReleaseComObject(instance); }
    }
}
