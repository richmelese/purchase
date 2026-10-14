Add-Type -AssemblyName System.IO.Compression.FileSystem
$filePath = "C:\Users\HP\Downloads\Telegram Desktop\EC Banck Reconcilation Form For ALL.xlsx"
$zip = [System.IO.Compression.ZipFile]::OpenRead($filePath)

# Read shared strings
$sst = New-Object System.Collections.Generic.List[string]
$sstEntry = $zip.GetEntry("xl/sharedStrings.xml")
if ($sstEntry) {
    $s = $sstEntry.Open()
    $xr = [System.Xml.XmlReader]::Create($s)
    while ($xr.Read()) {
        if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element -and $xr.LocalName -eq "t") {
            $sst.Add($xr.ReadElementContentAsString())
        }
    }
    $xr.Close()
    $s.Close()
}

function Dump-Populated-Rows($sheetFile, $maxRows = 15) {
    Write-Host "`nPopulated rows in ${sheetFile}:"
    $entry = $zip.GetEntry($sheetFile)
    $s = $entry.Open()
    $xr = [System.Xml.XmlReader]::Create($s)
    
    $curRow = ""
    $cells = New-Object System.Collections.Generic.List[string]
    $curRef = ""
    $curType = ""
    $curFormula = ""
    $printed = 0
    $hasRealData = $false
    
    while ($xr.Read()) {
        if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element) {
            if ($xr.LocalName -eq "row") {
                $curRow = $xr.GetAttribute("r")
                $cells.Clear()
                $hasRealData = $false
            } elseif ($xr.LocalName -eq "c") {
                $curRef = $xr.GetAttribute("r")
                $curType = $xr.GetAttribute("t")
                $curFormula = ""
            } elseif ($xr.LocalName -eq "f") {
                $curFormula = $xr.ReadElementContentAsString()
            } elseif ($xr.LocalName -eq "v") {
                $v = $xr.ReadElementContentAsString()
                $valStr = $v
                if ($curType -eq "s" -and $v -ne "") {
                    $idx = [int]$v
                    if ($idx -lt $sst.Count) { $valStr = $sst[$idx] }
                }
                # Check if it's real data (not just row number or 0 formula result)
                if (-not ($curRef -like "A*" -or ($curFormula -ne "" -and ($valStr -eq "0" -or $valStr -eq "")))) {
                    $hasRealData = $true
                }
                $cells.Add("${curRef}:$valStr")
            } elseif ($xr.LocalName -eq "t" -and $xr.Depth -gt 2) {
                $t = $xr.ReadElementContentAsString()
                $hasRealData = $true
                $cells.Add("${curRef}:$t")
            }
        } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and $xr.LocalName -eq "row") {
            if ($hasRealData) {
                Write-Host "Row $curRow -> $($cells -join ' | ')"
                $printed++
                if ($printed -ge $maxRows) { break }
            }
        }
    }
    $xr.Close()
    $s.Close()
    if ($printed -eq 0) { Write-Host "No populated data rows found (only empty formulas/numbers)." }
}

Dump-Populated-Rows "xl/worksheets/sheet4.xml" 15
Dump-Populated-Rows "xl/worksheets/sheet2.xml" 15
Dump-Populated-Rows "xl/worksheets/sheet3.xml" 15

$zip.Dispose()
