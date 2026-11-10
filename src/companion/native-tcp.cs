using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;

// Windows IP Helper owner-PID listener tables. No endpoint or PID is cached.
// https://learn.microsoft.com/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable
public static class CodexWallpaperTcp {
    [DllImport("iphlpapi.dll")]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref uint size,
        [MarshalAs(UnmanagedType.Bool)] bool sorted, uint family, int tableClass, uint reserved);

    public sealed class Listener {
        public string LocalAddress { get; set; }
        public int LocalPort { get; set; }
        public string RemoteAddress { get; set; }
        public int RemotePort { get; set; }
        public int OwningProcess { get; set; }
    }

    private static int Port(IntPtr row, int offset) {
        uint raw = unchecked((uint)Marshal.ReadInt32(row, offset));
        return (int)(((raw & 255) << 8) | ((raw >> 8) & 255));
    }

    private static string Address(IntPtr row, int offset, int length) {
        var bytes = new byte[length];
        Marshal.Copy(IntPtr.Add(row, offset), bytes, 0, length);
        return new IPAddress(bytes).ToString();
    }

    private static void Read(uint family, List<Listener> result) {
        uint size = 0;
        uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
        if (status != 0 && status != 122) throw new Win32Exception((int)status);
        for (int attempt = 0; attempt < 3; attempt++) {
            if (size < 4 || size > 16 * 1024 * 1024) throw new InvalidOperationException("Invalid TCP table size");
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try {
                uint available = size;
                status = GetExtendedTcpTable(buffer, ref available, false, family, 3, 0);
                if (status == 122) { size = available; continue; }
                if (status != 0) throw new Win32Exception((int)status);
                int count = Marshal.ReadInt32(buffer), stride = family == 2 ? 24 : 56;
                if (count < 0 || 4L + (long)count * stride > available)
                    throw new InvalidOperationException("Incomplete TCP table");
                for (int i = 0; i < count; i++) {
                    IntPtr row = IntPtr.Add(buffer, 4 + i * stride);
                    bool ipv4 = family == 2;
                    result.Add(new Listener {
                        LocalAddress = Address(row, ipv4 ? 4 : 0, ipv4 ? 4 : 16),
                        LocalPort = Port(row, ipv4 ? 8 : 20),
                        RemoteAddress = Address(row, ipv4 ? 12 : 24, ipv4 ? 4 : 16),
                        RemotePort = Port(row, ipv4 ? 16 : 44),
                        OwningProcess = Marshal.ReadInt32(row, ipv4 ? 20 : 52)
                    });
                }
                return;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        throw new InvalidOperationException("TCP table changed repeatedly");
    }

    public static Listener[] Snapshot() {
        var rows = new List<Listener>();
        Read(2, rows);  // AF_INET
        Read(23, rows); // AF_INET6, needed to retain same-port ambiguity checks
        return rows.ToArray();
    }
}
