// Launcher for Riftbound Training Center: runs Lancer.bat (local server + browser) from the folder of this .exe.
// Build (Windows, .NET Framework compiler):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /win32icon:assets\icon.ico /out:"Riftbound Training Center.exe" assets\launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class Launcher {
  [STAThread]
  static void Main() {
    string dir = AppDomain.CurrentDomain.BaseDirectory;
    string bat = Path.Combine(dir, "Lancer.bat");
    if (!File.Exists(bat)) { MessageBox.Show("Lancer.bat introuvable dans " + dir, "Riftbound Training Center"); return; }
    Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + bat + "\"") { WorkingDirectory = dir, UseShellExecute = true });
  }
}
