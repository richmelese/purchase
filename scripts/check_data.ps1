Add-Type -AssemblyName System.IO.Compression.FileSystem
$filePath = "C:\Users\HP\Downloads\Telegram Desktop\EC Banck Reconcilation Form For ALL.xlsx"
$zip = [System.IO.Compression.ZipFile]::OpenRead($filePath)

for ($i = 1; $i -le 10; $i++) {
    $sheetFile = "xl/worksheets/sheet$(3 + $i).xml"
    if ($i -eq 3) { $sheetFile = "xl/worksheets/sheet6.xml" } # check rels if needed
    $entry = $zip.GetEntry($sheetFile)
    if ($entry) {
        $s = $entry.Open()
        $xr = [System.Xml.XmlReader]::Create($s)
        $hasData = $false
        while ($xr.Read()) {
            if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element -and $xr.LocalName -eq "c") {
                $ref = $xr.GetAttribute("r")
                if ($ref -like "C*" -or $ref -like "F*" -or $ref -like "L*") {
                    $hasData = $true
                    break
                }
            }
        }
        $xr.Close()
        $s.Close()
        Write-Host "Bank $i ($sheetFile): has non-empty C/F/L = $hasData"
    }
}
$zip.Dispose()
