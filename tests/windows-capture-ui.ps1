param([string]$Exe,[string]$Image,[string]$Base)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type 'using System;using System.Runtime.InteropServices;public class CaptureUiNative{[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr d,uint f);[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}'
$p=Start-Process -FilePath $Exe -ArgumentList @('--file',('"'+$Image+'"')) -WindowStyle Normal -PassThru
try {
 $pidCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$p.Id)
 $window=$null
 for($i=0;$i -lt 100;$i++){$window=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$pidCondition);if($window){break};Start-Sleep -Milliseconds 100}
 if(!$window){throw 'Capture window did not appear'}
 function Find-Name([string]$value){$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$value);return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)}
 function Wait-Name([string]$value){for($i=0;$i -lt 150;$i++){$node=Find-Name $value;if($node){return $node};Start-Sleep -Milliseconds 100};throw ('Missing UI: '+$value)}
 function Click([string]$value){$node=Wait-Name $value;if(!$node.Current.IsEnabled){throw ('Disabled: '+$value)};$pattern=$null;if($node.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}elseif($node.Current.ClassName -like 'WindowsForms10.BUTTON*'){$null=[CaptureUiNative]::SendMessage([IntPtr]$node.Current.NativeWindowHandle,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)}else{throw ('No action pattern: '+$value+' '+$node.Current.ClassName)}}
 $null=Wait-Name '知识库列表已更新'
 $combo=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::ComboBox)));if(!$combo){$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|ForEach-Object {Write-Output ($_.Current.ControlType.ProgrammaticName+'|'+$_.Current.Name+'|'+$_.Current.ClassName)};throw 'No native combo'};$combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand();Start-Sleep -Milliseconds 150
 $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'Windows 验证库')
 $item=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
 if(!$item){throw 'Library option missing'};$item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
 $null=Invoke-RestMethod ($Base+'/test/control?mode=fail-list');Click '刷新';$null=Wait-Name '刷新失败，已保留原选项'
 $null=Invoke-RestMethod ($Base+'/test/control?mode=fail-save');Click '保存到知识库';$null=Wait-Name '重试保存'
 $null=Invoke-RestMethod ($Base+'/test/control?mode=online');Click '重试保存';$null=Wait-Name '已保存到 ZNote'
 Add-Type -AssemblyName System.Drawing
 $rect=$window.Current.BoundingRectangle;$bitmap=New-Object Drawing.Bitmap([int]$rect.Width,[int]$rect.Height);$graphics=[Drawing.Graphics]::FromImage($bitmap);$dc=$graphics.GetHdc();try{$null=[CaptureUiNative]::PrintWindow([IntPtr]$window.Current.NativeWindowHandle,$dc,0)}finally{$graphics.ReleaseHdc($dc);$graphics.Dispose()};$bitmap.Save((Join-Path ([IO.Path]::GetDirectoryName($Image)) 'window.png'));$bitmap.Dispose()
 $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
 'WINDOWS_CAPTURE_UI_PASS'
}finally{if(!$p.HasExited){Stop-Process -Id $p.Id -ErrorAction SilentlyContinue}}
