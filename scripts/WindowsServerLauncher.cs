using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Threading;

// Loaded in PowerShell inside the system-provided headless conhost.
// Log the child's real exit code (conhost may not propagate it). Children
// belong to an owned job so a forced launcher stop also stops the server.
public static class WindowsServerLauncher
{
    private static string logPath;
    // Intentionally held until process exit. The OS closes this non-inheritable
    // handle even when Task Scheduler forcibly terminates the launcher.
    private static IntPtr processJob;
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    private static void OwnProcessTree()
    {
        processJob = CreateJobObject(IntPtr.Zero, null);
        if (processJob == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(processJob, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits)))) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!AssignProcessToJobObject(processJob, Process.GetCurrentProcess().Handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static readonly object LogLock = new object();
    private static string Quote(string value)
    {
        return "\"" + Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"")
            .TrimEnd('\\') + new string('\\', value.Length - value.TrimEnd('\\').Length) +
            new string('\\', value.Length - value.TrimEnd('\\').Length) + "\"";
    }
    private static void Log(string text)
    {
        if (logPath == null) return;
        lock (LogLock) try
        {
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 5 * 1024 * 1024)
            {
                if (File.Exists(logPath + ".previous")) File.Delete(logPath + ".previous");
                File.Move(logPath, logPath + ".previous");
            }
            File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine);
        }
        catch { /* A logging failure must not mask the process exit code. */ }
    }
    public static int Run(string[] args)
    {
        try
        {
            if (args.Length != 4 && args.Length != 5) return 2;
            string logs = Path.Combine(Path.GetFullPath(args[2]), "logs");
            Directory.CreateDirectory(logs); logPath = Path.Combine(logs, "launcher.log");
            int port;
            if (!int.TryParse(args[3], out port) || port < 1 || port > 65535) throw new ArgumentException("Invalid port");
            OwnProcessTree();
            if (args.Length == 5)
            {
                // Task Scheduler terminates conhost, not necessarily its clients.
                // Keep an open process handle so PID reuse cannot hide owner exit.
                var owner = Process.GetProcessById(int.Parse(args[4]));
                if (owner.ProcessName != "conhost") throw new ArgumentException("Expected conhost owner");
                var ownerHandle = owner.Handle;
                Log("host_attached hostPid=" + owner.Id);
                var watcher = new Thread(() => {
                    owner.WaitForExit();
                    Log("host_exit hostPid=" + owner.Id + "; stopping owned server tree");
                    Environment.Exit(1);
                });
                watcher.IsBackground = true; watcher.Start();
            }
            var info = new ProcessStartInfo(Path.GetFullPath(args[0]), Quote(Path.GetFullPath(args[1])) + " " + Quote(Path.GetFullPath(args[2])) + " " + port);
            info.WorkingDirectory = Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(args[1])));
            info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            using (var child = new Process())
            {
                child.StartInfo = info;
                child.OutputDataReceived += (s, e) => { if (e.Data != null) Log("stdout " + e.Data); };
                child.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("stderr " + e.Data); };
                child.Start();
                child.StandardInput.Close(); // Never inherit an invalid console stdin handle.
                Log("child_start launcherPid=" + Process.GetCurrentProcess().Id + " childPid=" + child.Id);
                child.BeginOutputReadLine(); child.BeginErrorReadLine();
                child.WaitForExit();
                Log("child_exit childPid=" + child.Id + " code=" + child.ExitCode + " hex=0x" + unchecked((uint)child.ExitCode).ToString("X8"));
                return child.ExitCode;
            }
        }
        catch (Exception error) { Log("launcher_failure " + error.GetType().Name + ": " + error.Message); return 1; }
    }
}
