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

$sheetFiles = @{
    "Menu" = "xl/worksheets/sheet1.xml";
    "Sales" = "xl/worksheets/sheet2.xml";
    "Purchase" = "xl/worksheets/sheet3.xml";
    "Bank 01" = "xl/worksheets/sheet4.xml";
    "Bank 02" = "xl/worksheets/sheet5.xml";
}

function Dump-Data-Rows($sheetName, $file, $maxDataRows = 15) {
    Write-Host "`n======================================================="
    Write-Host "DATA ROWS IN: $sheetName ($file)"
    Write-Host "======================================================="
    $entry = $zip.GetEntry($file)
    $s = $entry.Open()
    $xr = [System.Xml.XmlReader]::Create($s)
    
    $curRow = ""
    $rowCells = New-Object System.Collections.Generic.List[string]
    $curCellRef = ""
    $curCellType = ""
    $curFormula = ""
    $foundDataCount = 0
    
    while ($xr.Read()) {
        if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element) {
            if ($xr.LocalName -eq "row") {
                $curRow = $xr.GetAttribute("r")
                $rowCells.Clear()
            } elseif ($xr.LocalName -eq "c") {
                $curCellRef = $xr.GetAttribute("r")
                $curCellType = $xr.GetAttribute("t")
                $curFormula = ""
            } elseif ($xr.LocalName -eq "f") {
                $curFormula = $xr.ReadElementContentAsString()
            } elseif ($xr.LocalName -eq "v") {
                $v = $xr.ReadElementContentAsString()
                $valStr = $v
                if ($curCellType -eq "s" -and $v -ne "") {
                    $idx = [int]$v
                    if ($idx -lt $sst.Count) { $valStr = $sst[$idx] }
                }
                if ($curFormula -ne "") {
                    $rowCells.Add("${curCellRef}: =${curFormula} [res:${valStr}]")
                } else {
                    $rowCells.Add("${curCellRef}: ${valStr}")
                }
            } elseif ($xr.LocalName -eq "t" -and $xr.Depth -gt 2) {
                $t = $xr.ReadElementContentAsString()
                $rowCells.Add("${curCellRef}: ${t}")
            }
        } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and $xr.LocalName -eq "row") {
            # Print if row is header or has more than 1 cell or has interesting values
            if ($rowCells.Count -gt 1 -or [int]$curRow -eq 1 -or [int]$curRow -eq 2) {
                Write-Host "R${curRow}: $($rowCells -join ' | ')"
                $foundDataCount++
                if ($foundDataCount -ge $maxDataRows) { break }
            }
        }
    }
    $xr.Close()
    $s.Close()
}

Dump-Data-Rows "Bank 01" $sheetFiles["Bank 01"] 15
Dump-Data-Rows "Sales" $sheetFiles["Sales"] 10
Dump-Data-Rows "Purchase" $sheetFiles["Purchase"] 10

$zip.Dispose()
