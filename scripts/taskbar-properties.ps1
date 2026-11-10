if(-not ('CodexTaskbarIdentity' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CodexTaskbarIdentity {
 [StructLayout(LayoutKind.Sequential)] public struct Key {public Guid fmtid;public uint pid;}
 [StructLayout(LayoutKind.Explicit,Size=24)] public struct Value {[FieldOffset(0)]public ushort vt;[FieldOffset(8)]public IntPtr text;}
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Store {
  [PreserveSig]int GetCount(out uint c);[PreserveSig]int GetAt(uint i,out Key k);[PreserveSig]int GetValue(ref Key k,out Value v);[PreserveSig]int SetValue(ref Key k,ref Value v);[PreserveSig]int Commit();
 }
 [DllImport("shell32.dll")]static extern int SHGetPropertyStoreForWindow(IntPtr h,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out Store s);
 [DllImport("ole32.dll")]static extern int PropVariantClear(ref Value v);
 static Key Id(uint number){return new Key{fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),pid=number};}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern int SHGetPropertyStoreFromParsingName(string path,IntPtr bind,uint flags,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out Store s);
 static Store OpenFile(string path,bool write){var id=typeof(Store).GUID;Store s;Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path,IntPtr.Zero,write?2u:0u,ref id,out s));return s;}
 static Store Open(IntPtr h){var id=typeof(Store).GUID;Store s;Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(h,ref id,out s));return s;}
 static string ReadValue(Store s,uint n){var k=Id(n);Value v;try{Marshal.ThrowExceptionForHR(s.GetValue(ref k,out v));try{return v.vt==31?Marshal.PtrToStringUni(v.text):null;}finally{PropVariantClear(ref v);}}finally{Marshal.ReleaseComObject(s);}}
 static void WriteValue(Store s,uint n,string text,bool commit){var k=Id(n);var v=new Value{vt=31,text=Marshal.StringToCoTaskMemUni(text)};try{Marshal.ThrowExceptionForHR(s.SetValue(ref k,ref v));if(commit)Marshal.ThrowExceptionForHR(s.Commit());}finally{PropVariantClear(ref v);Marshal.ReleaseComObject(s);}}
 public static string Read(IntPtr h,uint n){return ReadValue(Open(h),n);}
 public static void Write(IntPtr h,uint n,string text){WriteValue(Open(h),n,text,false);}
 public static string ReadFile(string path,uint n){return ReadValue(OpenFile(path,false),n);}
 public static void WriteFile(string path,uint n,string text){WriteValue(OpenFile(path,true),n,text,true);}

}
'@}
