Add-Type -AssemblyName System.IO.Compression.FileSystem
$filePath = "C:\Users\HP\Downloads\Telegram Desktop\EC Banck Reconcilation Form For ALL.xlsx"
$zip = [System.IO.Compression.ZipFile]::OpenRead($filePath)

function Show-Raw-Row($file, $rowNum) {
    Write-Host "`nRAW ROW $rowNum in $file"
    $entry = $zip.GetEntry($file)
    $s = $entry.Open()
    $xr = [System.Xml.XmlReader]::Create($s)
    while ($xr.Read()) {
        if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element -and $xr.LocalName -eq "row" -and $xr.GetAttribute("r") -eq [string]$rowNum) {
            $inner = $xr.ReadOuterXml()
            Write-Host $inner
            break
        }
    }
    $xr.Close()
    $s.Close()
}

Show-Raw-Row "xl/worksheets/sheet4.xml" 2
Show-Raw-Row "xl/worksheets/sheet2.xml" 2
Show-Raw-Row "xl/worksheets/sheet3.xml" 2

$zip.Dispose()
