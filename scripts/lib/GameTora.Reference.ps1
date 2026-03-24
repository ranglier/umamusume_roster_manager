$script:ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:SchemaVersion = '1.0.0'
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8Bom = New-Object System.Text.UTF8Encoding($true)

$script:TrackNames = @{
    '10001' = 'Sapporo'
    '10002' = 'Hakodate'
    '10003' = 'Niigata'
    '10004' = 'Fukushima'
    '10005' = 'Nakayama'
    '10006' = 'Tokyo'
    '10007' = 'Chukyo'
    '10008' = 'Kyoto'
    '10009' = 'Hanshin'
    '10010' = 'Kokura'
    '10101' = 'Ooi'
    '10103' = 'Kawasaki'
    '10104' = 'Funabashi'
    '10105' = 'Morioka'
    '10201' = 'Longchamp'
    '10202' = 'Santa Anita Park'
}

$script:TrackSlugs = @{
    '10001' = 'sapporo'
    '10002' = 'hakodate'
    '10003' = 'niigata'
    '10004' = 'fukushima'
    '10005' = 'nakayama'
    '10006' = 'tokyo'
    '10007' = 'chukyo'
    '10008' = 'kyoto'
    '10009' = 'hanshin'
    '10010' = 'kokura'
    '10101' = 'ooi'
    '10103' = 'kawasaki'
    '10104' = 'funabashi'
    '10105' = 'morioka'
    '10201' = 'longchamp'
    '10202' = 'santa-anita-park'
}

$script:AptitudeOrder = @{
    'S' = 8
    'A' = 7
    'B' = 6
    'C' = 5
    'D' = 4
    'E' = 3
    'F' = 2
    'G' = 1
}

$script:AptitudeDisplayLabels = @{
    'turf' = 'Turf'
    'dirt' = 'Dirt'
    'short' = 'Short'
    'mile' = 'Mile'
    'medium' = 'Medium'
    'long' = 'Long'
    'runner' = 'Front'
    'leader' = 'Pace'
    'betweener' = 'Late'
    'chaser' = 'End'
}

$script:SkillTagDisplayLabels = @{
    'tur' = 'Turf'
    'dir' = 'Dirt'
    'sho' = 'Short'
    'mil' = 'Mile'
    'med' = 'Medium'
    'lng' = 'Long'
    'run' = 'Front'
    'ldr' = 'Pace'
    'btw' = 'Late'
    'cha' = 'End'
    'str' = 'Straight'
    'cor' = 'Corner'
    'slo' = 'Slope'
    'f_s' = 'Final Straight'
    'f_c' = 'Final Corner'
    'l_0' = 'Early Race'
    'l_1' = 'Mid Race'
    'l_2' = 'Late Race'
    'l_3' = 'Last Spurt'
    'dbf' = 'Debuff'
    'nac' = 'General'
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-Utf8File {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content,
        [switch]$WithBom
    )

    Ensure-Directory -Path (Split-Path -Parent $Path)

    if ($WithBom) {
        $preamble = $script:Utf8Bom.GetPreamble()
        $bytes = $script:Utf8NoBom.GetBytes($Content)
        $output = New-Object byte[] ($preamble.Length + $bytes.Length)
        [Array]::Copy($preamble, 0, $output, 0, $preamble.Length)
        [Array]::Copy($bytes, 0, $output, $preamble.Length, $bytes.Length)
        [System.IO.File]::WriteAllBytes($Path, $output)
        return
    }

    [System.IO.File]::WriteAllText($Path, $Content, $script:Utf8NoBom)
}

function Write-BinaryFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes
    )

    Ensure-Directory -Path (Split-Path -Parent $Path)
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Object,
        [switch]$Compress
    )

    $json = if ($Compress) {
        $Object | ConvertTo-Json -Depth 100 -Compress
    }
    else {
        $Object | ConvertTo-Json -Depth 100
    }

    Write-Utf8File -Path $Path -Content $json
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) | ConvertFrom-Json
}

function As-Array {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [System.Array]) {
        return @($Value)
    }

    return @($Value)
}

function Get-NamedValue {
    param(
        $Container,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Container) {
        return $null
    }

    if ($Container -is [System.Collections.IDictionary]) {
        return $Container[$Name]
    }

    $property = $Container.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    $property.Value
}

function Coalesce {
    param([object[]]$Values)

    if ($null -eq $Values) {
        return $null
    }

    foreach ($value in $Values) {
        if ($null -eq $value) {
            continue
        }

        if ($value -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value
            }
        }
        else {
            return $value
        }
    }

    $null
}

function Get-NowIso {
    [DateTimeOffset]::UtcNow.ToString('o')
}

function Get-Config {
    Read-JsonFile -Path (Join-Path $script:ProjectRoot 'config/sources.json')
}

function Join-UrlPath {
    param(
        [Parameter(Mandatory = $true)][string]$Base,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if ($Path -match '^https?://') {
        return $Path
    }

    '{0}/{1}' -f $Base.TrimEnd('/'), $Path.TrimStart('/')
}

function Expand-TemplateString {
    param(
        [Parameter(Mandatory = $true)][string]$Template,
        [Parameter(Mandatory = $true)][hashtable]$Values
    )

    $result = $Template
    foreach ($key in $Values.Keys) {
        $result = $result.Replace(('{' + $key + '}'), [string]$Values[$key])
    }

    $result
}

function New-AssetDescriptor {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$AssetKey,
        [Parameter(Mandatory = $true)][hashtable]$Tokens,
        [Parameter(Mandatory = $true)][string]$Alt
    )

    $definition = Get-NamedValue -Container $Config.assets -Name $AssetKey
    if ($null -eq $definition) {
        return $null
    }

    $relativePath = (Expand-TemplateString -Template $definition.pathTemplate -Values $Tokens) -replace '\\', '/'
    $urlPath = Expand-TemplateString -Template $definition.urlTemplate -Values $Tokens

    [ordered]@{
        key = $AssetKey
        role = $definition.role
        type = 'image'
        relative_path = $relativePath
        source_url = Join-UrlPath -Base $Config.assetBaseUrl -Path $urlPath
        content_type = 'image/png'
        alt = $Alt
    }
}

function Invoke-RemoteJson {
    param([Parameter(Mandatory = $true)][string]$Url)

    $client = New-Object System.Net.WebClient
    try {
        $client.Headers['User-Agent'] = 'Umamusume-Roster-Manager/1.0 (+local reference build)'
        $bytes = $client.DownloadData($Url)
        $raw = [System.Text.Encoding]::UTF8.GetString($bytes)
    }
    finally {
        $client.Dispose()
    }

    @{
        Raw = $raw
        Json = $raw | ConvertFrom-Json
    }
}

function Invoke-RemoteBinary {
    param([Parameter(Mandatory = $true)][string]$Url)

    $client = New-Object System.Net.WebClient
    try {
        $client.Headers['User-Agent'] = 'Umamusume-Roster-Manager/1.0 (+local reference build)'
        $bytes = $client.DownloadData($Url)
    }
    finally {
        $client.Dispose()
    }

    $bytes
}

function Get-RawDatasetPath {
    param(
        [Parameter(Mandatory = $true)][string]$RawRoot,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Hash
    )

    $segments = $Key -split '/'
    $directory = $RawRoot

    if ($segments.Count -gt 1) {
        foreach ($segment in $segments[0..($segments.Count - 2)]) {
            $directory = Join-Path $directory $segment
        }
    }

    $leaf = '{0}.{1}.json' -f $segments[$segments.Count - 1], $Hash
    Join-Path $directory $leaf
}

function Get-MetadataPath {
    Join-Path $script:ProjectRoot 'data/raw/metadata.json'
}

function Get-AssetMetadataPath {
    Join-Path $script:ProjectRoot 'data/raw/assets/metadata.json'
}

function Get-ExistingRawMetadata {
    $path = Get-MetadataPath
    if (Test-Path -LiteralPath $path) {
        return Read-JsonFile -Path $path
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        game = 'umamusume'
        datasets = [ordered]@{}
    }
}

function Get-ExistingAssetMetadata {
    $path = Get-AssetMetadataPath
    if (Test-Path -LiteralPath $path) {
        return Read-JsonFile -Path $path
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        generated_at = $null
        asset_base_url = $null
        asset_serve_base_path = $null
        counts = [ordered]@{
            total = 0
            downloaded = 0
            reused = 0
            stale = 0
            failed = 0
        }
        assets = [ordered]@{}
    }
}

function Get-EntityDefinition {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$EntityKey
    )

    foreach ($entity in As-Array $Config.entities) {
        if ($entity.key -eq $EntityKey) {
            return $entity
        }
    }

    throw "Unknown entity definition: $EntityKey"
}

function New-SourceStamp {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)][string]$EntityKey
    )

    $entity = Get-EntityDefinition -Config $Config -EntityKey $EntityKey
    $datasets = @()
    $hashes = [ordered]@{}
    $latest = $null

    foreach ($datasetKey in As-Array $entity.datasetKeys) {
        $entry = Get-NamedValue -Container $Metadata.datasets -Name $datasetKey
        if ($null -eq $entry) {
            continue
        }

        $hashes[$datasetKey] = $entry.hash
        $datasets += [ordered]@{
            key = $datasetKey
            hash = $entry.hash
            url = $entry.url
            local_path = $entry.local_path
            downloaded_at = $entry.downloaded_at
        }

        if ($null -eq $latest -or [DateTimeOffset]$entry.downloaded_at -gt [DateTimeOffset]$latest) {
            $latest = $entry.downloaded_at
        }
    }

    [ordered]@{
        entity = $EntityKey
        label = $entity.label
        source_site = $Config.sourceSite
        imported_at = $latest
        page_urls = As-Array $entity.pageUrls
        dataset_keys = As-Array $entity.datasetKeys
        dataset_hashes = $hashes
        datasets = $datasets
    }
}

function Sync-ReferenceRawData {
    param([switch]$Force)

    $config = Get-Config
    $rawRoot = Join-Path $script:ProjectRoot 'data/raw/umamusume'
    $manifestRoot = Join-Path $script:ProjectRoot 'data/raw/manifests'
    Ensure-Directory -Path $rawRoot
    Ensure-Directory -Path $manifestRoot

    $existingMetadata = Get-ExistingRawMetadata
    $manifestResult = Invoke-RemoteJson -Url $config.manifestUrl
    $manifest = $manifestResult.Json
    $manifestPath = Join-Path $manifestRoot 'umamusume.json'
    Write-Utf8File -Path $manifestPath -Content $manifestResult.Raw

    $datasetMetadata = [ordered]@{}
    foreach ($dataset in As-Array $config.datasets) {
        $key = $dataset.key
        $hash = Get-NamedValue -Container $manifest -Name $key
        if ([string]::IsNullOrWhiteSpace($hash)) {
            throw "Missing manifest hash for dataset key: $key"
        }

        $localPath = Get-RawDatasetPath -RawRoot $rawRoot -Key $key -Hash $hash
        $remoteUrl = '{0}/{1}.{2}.json' -f $config.datasetBaseUrl, $key, $hash
        $previous = Get-NamedValue -Container $existingMetadata.datasets -Name $key

        $shouldDownload = $Force -or -not (Test-Path -LiteralPath $localPath)
        if (-not $shouldDownload -and $null -ne $previous) {
            $shouldDownload = ($previous.hash -ne $hash)
        }

        $downloadedAt = if ($null -ne $previous) { $previous.downloaded_at } else { $null }
        $status = 'reused'

        if ($shouldDownload) {
            Write-Host ("Syncing raw dataset {0}..." -f $key)
            $datasetResult = Invoke-RemoteJson -Url $remoteUrl
            Write-Utf8File -Path $localPath -Content $datasetResult.Raw
            $downloadedAt = Get-NowIso
            $status = 'downloaded'
        }

        $datasetMetadata[$key] = [ordered]@{
            key = $key
            hash = $hash
            url = $remoteUrl
            page_url = $dataset.pageUrl
            local_path = $localPath
            downloaded_at = $downloadedAt
            checked_at = Get-NowIso
            status = $status
        }
    }

    $metadata = [ordered]@{
        schema_version = $script:SchemaVersion
        game = $config.game
        source_site = $config.sourceSite
        manifest_url = $config.manifestUrl
        manifest_local_path = $manifestPath
        manifest_checked_at = Get-NowIso
        datasets = $datasetMetadata
    }

    Write-JsonFile -Path (Get-MetadataPath) -Object $metadata

    [ordered]@{
        config = $config
        manifest = $manifest
        metadata = $metadata
    }
}

function Load-RawDatasetByKey {
    param(
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)][string]$Key
    )

    $entry = Get-NamedValue -Container $Metadata.datasets -Name $Key
    if ($null -eq $entry) {
        throw "Dataset metadata missing for key: $Key"
    }

    Read-JsonFile -Path $entry.local_path
}

function Get-TrackName {
    param([string]$TrackId)

    if ($script:TrackNames.ContainsKey($TrackId)) {
        return $script:TrackNames[$TrackId]
    }

    'Unknown racetrack'
}

function Get-TrackSlug {
    param([string]$TrackId)

    if ($script:TrackSlugs.ContainsKey($TrackId)) {
        return $script:TrackSlugs[$TrackId]
    }

    'unknown-racetrack'
}

function Get-TerrainLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Turf' }
        2 { 'Dirt' }
        99999 { 'Varies' }
        default { 'Unknown' }
    }
}

function Get-TerrainSlug {
    param($Value)

    switch ([int]$Value) {
        1 { 'turf' }
        2 { 'dirt' }
        99999 { 'varies' }
        default { 'unknown' }
    }
}

function Get-DirectionLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Right' }
        2 { 'Left' }
        3 { 'Straight' }
        4 { 'Straight' }
        99999 { 'Varies' }
        default { 'Unknown' }
    }
}

function Get-DirectionSlug {
    param($Value)

    switch ([int]$Value) {
        1 { 'right' }
        2 { 'left' }
        3 { 'straight' }
        4 { 'straight' }
        99999 { 'varies' }
        default { 'unknown' }
    }
}

function Get-SeasonLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Spring' }
        2 { 'Summer' }
        3 { 'Fall' }
        4 { 'Winter' }
        5 { 'Spring' }
        default { 'Unknown' }
    }
}

function Get-SeasonSlug {
    param($Value)

    switch ([int]$Value) {
        1 { 'spring' }
        2 { 'summer' }
        3 { 'fall' }
        4 { 'winter' }
        5 { 'spring' }
        default { 'unknown' }
    }
}

function Get-TimeOfDayLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Morning' }
        2 { 'Daytime' }
        3 { 'Evening' }
        4 { 'Night' }
        default { 'Unknown' }
    }
}

function Get-TimeOfDaySlug {
    param($Value)

    switch ([int]$Value) {
        1 { 'morning' }
        2 { 'daytime' }
        3 { 'evening' }
        4 { 'night' }
        default { 'unknown' }
    }
}

function Get-CourseLayoutLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Main' }
        2 { 'Inner' }
        3 { 'Outer' }
        4 { 'Outer to Inner' }
        99999 { 'Varies' }
        default { 'Unknown' }
    }
}

function Get-CourseLayoutSlug {
    param($Value)

    switch ([int]$Value) {
        1 { 'main' }
        2 { 'inner' }
        3 { 'outer' }
        4 { 'outer-to-inner' }
        99999 { 'varies' }
        default { 'unknown' }
    }
}

function Get-DistanceCategoryLabel {
    param($Meters)

    if ([int]$Meters -ge 99999) {
        return 'Varies'
    }

    if ([int]$Meters -lt 1401) {
        return 'Short'
    }

    if ([int]$Meters -lt 1801) {
        return 'Mile'
    }

    if ([int]$Meters -lt 2401) {
        return 'Medium'
    }

    'Long'
}

function Get-DistanceCategorySlug {
    param($Meters)

    if ([int]$Meters -ge 99999) {
        return 'varies'
    }

    if ([int]$Meters -lt 1401) {
        return 'short'
    }

    if ([int]$Meters -lt 1801) {
        return 'mile'
    }

    if ([int]$Meters -lt 2401) {
        return 'medium'
    }

    'long'
}

function Get-DistanceCategoryFromCode {
    param($Value)

    switch ([int]$Value) {
        1 { 'Short' }
        2 { 'Mile' }
        3 { 'Medium' }
        4 { 'Long' }
        99999 { 'Varies' }
        default { 'Unknown' }
    }
}

function Get-DistanceCategorySlugFromCode {
    param($Value)

    switch ([int]$Value) {
        1 { 'short' }
        2 { 'mile' }
        3 { 'medium' }
        4 { 'long' }
        99999 { 'varies' }
        default { 'unknown' }
    }
}

function Get-RaceGradeLabel {
    param($Group, $Grade)

    $groupId = [int]$Group
    $gradeId = [int]$Grade

    $map = @{
        1 = @{ 100 = 'G1'; 200 = 'G2'; 300 = 'G3'; 400 = 'OP'; 700 = 'Pre-OP' }
        2 = @{ 999 = 'EX' }
        7 = @{ 100 = 'EX'; 800 = 'Maiden'; 900 = 'Debut' }
        8 = @{ 100 = 'EX' }
        9 = @{ 100 = 'G1' }
        61 = @{ 100 = 'G1' }
    }

    if ($map.ContainsKey($groupId) -and $map[$groupId].ContainsKey($gradeId)) {
        return $map[$groupId][$gradeId]
    }

    'Unknown grade'
}

function Get-SexLabel {
    param($Value)

    switch ([int]$Value) {
        1 { 'Mare' }
        2 { 'Stallion' }
        default { 'Unknown' }
    }
}

function Convert-SkillRef {
    param(
        $SkillId,
        [Parameter(Mandatory = $true)]$SkillLookup
    )

    if ($null -eq $SkillId) {
        return $null
    }

    $key = [string]$SkillId
    $skill = Get-NamedValue -Container $SkillLookup -Name $key
    $geneVersion = if ($null -ne $skill) { Get-NamedValue -Container $skill -Name 'gene_version' } else { $null }
    $skillName = if ($null -ne $skill) {
        Coalesce @(
            (Get-NamedValue -Container $skill -Name 'name_en'),
            (Get-NamedValue -Container $skill -Name 'enname'),
            (Get-NamedValue -Container $skill -Name 'jpname')
        )
    } else { $null }
    $skillRarity = if ($null -ne $skill) { Get-NamedValue -Container $skill -Name 'rarity' } else { $null }
    $skillCost = if ($null -ne $skill) {
        Coalesce @(
            (Get-NamedValue -Container $skill -Name 'cost'),
            (Get-NamedValue -Container $geneVersion -Name 'cost')
        )
    } else { $null }

    [ordered]@{
        id = [int]$SkillId
        name = $skillName
        rarity = if ($null -ne $skillRarity) { [int]$skillRarity } else { $null }
        cost = $skillCost
    }
}

function Convert-SkillIdList {
    param(
        $Ids,
        [Parameter(Mandatory = $true)]$SkillLookup
    )

    $result = @()
    foreach ($skillId in As-Array $Ids) {
        $ref = Convert-SkillRef -SkillId $skillId -SkillLookup $SkillLookup
        if ($null -ne $ref) {
            $result += $ref
        }
    }
    $result
}

function Convert-ConditionGroups {
    param($ConditionGroups)

    $groups = @()
    foreach ($group in As-Array $ConditionGroups) {
        $effects = @()
        foreach ($effect in As-Array $group.effects) {
            $effects += [ordered]@{
                type = [int]$effect.type
                value = Coalesce @($effect.value, $effect.value_1)
            }
        }

        $groups += [ordered]@{
            base_time = $group.base_time
            precondition = $group.precondition
            condition = $group.condition
            effects = $effects
        }
    }

    $groups
}

function Convert-SupportEffectEntries {
    param(
        $RawEffects,
        [Parameter(Mandatory = $true)]$EffectLookup
    )

    $effects = @()

    foreach ($raw in As-Array $RawEffects) {
        if ((As-Array $raw).Count -lt 1) {
            continue
        }

        $effectId = [int]$raw[0]
        $catalog = Get-NamedValue -Container $EffectLookup -Name ([string]$effectId)
        $values = @()

        for ($index = 1; $index -lt $raw.Count; $index++) {
            $value = [double]$raw[$index]
            if ($value -ge 0) {
                $values += [ordered]@{
                    stage_index = $index
                    value = $value
                }
            }
        }

        $maxValue = $null
        if ($values.Count -gt 0) {
            $maxValue = ($values | Sort-Object value -Descending | Select-Object -First 1).value
        }

        $effects += [ordered]@{
            effect_id = $effectId
            name = if ($null -ne $catalog) { Coalesce @($catalog.name_en_eon, $catalog.name_en, $catalog.name_ja) } else { $null }
            description = if ($null -ne $catalog) { Coalesce @($catalog.desc_en_eon, $catalog.desc_en, $catalog.desc_ja) } else { $null }
            calc = if ($null -ne $catalog) { $catalog.calc } else { $null }
            symbol = if ($null -ne $catalog) { $catalog.symbol } else { $null }
            max_value = $maxValue
            values = $values
        }
    }

    $effects
}

function Convert-SupportUniqueEffects {
    param(
        $Unique,
        [Parameter(Mandatory = $true)]$EffectLookup
    )

    if ($null -eq $Unique) {
        return @()
    }

    $effects = @()
    foreach ($entry in As-Array $Unique.effects) {
        $catalog = Get-NamedValue -Container $EffectLookup -Name ([string]$entry.type)
        $effects += [ordered]@{
            effect_id = [int]$entry.type
            name = if ($null -ne $catalog) { Coalesce @($catalog.name_en_eon, $catalog.name_en, $catalog.name_ja) } else { $null }
            description = if ($null -ne $catalog) { Coalesce @($catalog.desc_en_eon, $catalog.desc_en, $catalog.desc_ja) } else { $null }
            calc = if ($null -ne $catalog) { $catalog.calc } else { $null }
            symbol = if ($null -ne $catalog) { $catalog.symbol } else { $null }
            value = $entry.value
        }
    }

    $effects
}

function Get-AptitudeValue {
    param([string]$Letter)

    if ([string]::IsNullOrWhiteSpace($Letter)) {
        return 0
    }

    if ($script:AptitudeOrder.ContainsKey($Letter.ToUpperInvariant())) {
        return $script:AptitudeOrder[$Letter.ToUpperInvariant()]
    }

    0
}

function Get-ViableAptitudes {
    param([Parameter(Mandatory = $true)]$Map)

    $result = @()
    foreach ($property in $Map.GetEnumerator()) {
        if ((Get-AptitudeValue -Letter $property.Value) -ge (Get-AptitudeValue -Letter 'A')) {
            $result += $property.Key
        }
    }
    $result
}

function Get-BirthdayString {
    param($Record)

    $year = Coalesce @($Record.birth_year, $Record.birthYear)
    $month = Coalesce @($Record.birth_month, $Record.birthMonth)
    $day = Coalesce @($Record.birth_day, $Record.birthDay)

    if ($null -eq $month -or $null -eq $day) {
        return $null
    }

    if ($null -eq $year) {
        return ('{0:D2}-{1:D2}' -f [int]$month, [int]$day)
    }

    ('{0:D4}-{1:D2}-{2:D2}' -f [int]$year, [int]$month, [int]$day)
}

function Build-Lookup {
    param(
        [Parameter(Mandatory = $true)]$Items,
        [Parameter(Mandatory = $true)][string]$Property
    )

    $lookup = @{}
    foreach ($item in As-Array $Items) {
        $value = [string](Get-NamedValue -Container $item -Name $Property)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $lookup[$value] = $item
        }
    }
    $lookup
}

function Build-GroupLookup {
    param(
        [Parameter(Mandatory = $true)]$Items,
        [Parameter(Mandatory = $true)][string]$Property
    )

    $lookup = @{}
    foreach ($item in As-Array $Items) {
        $value = [string](Get-NamedValue -Container $item -Name $Property)
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }

        if (-not $lookup.ContainsKey($value)) {
            $lookup[$value] = @()
        }

        $lookup[$value] += $item
    }
    $lookup
}

function Normalize-Characters {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$BaseCharacters,
        [Parameter(Mandatory = $true)]$CharacterCards,
        [Parameter(Mandatory = $true)]$Skills
    )

    $baseLookup = Build-Lookup -Items $BaseCharacters -Property 'char_id'
    $skillLookup = Build-Lookup -Items $Skills -Property 'id'
    $items = @()

    foreach ($card in As-Array $CharacterCards) {
        $base = Get-NamedValue -Container $baseLookup -Name ([string]$card.char_id)

        $surface = [ordered]@{
            turf = $card.aptitude[0]
            dirt = $card.aptitude[1]
        }
        $distance = [ordered]@{
            short = $card.aptitude[2]
            mile = $card.aptitude[3]
            medium = $card.aptitude[4]
            long = $card.aptitude[5]
        }
        $style = [ordered]@{
            runner = $card.aptitude[6]
            leader = $card.aptitude[7]
            betweener = $card.aptitude[8]
            chaser = $card.aptitude[9]
        }

        $skillsEvo = @()
        foreach ($evo in As-Array $card.skills_evo) {
            $skillsEvo += [ordered]@{
                from = Convert-SkillRef -SkillId $evo.old -SkillLookup $skillLookup
                to = Convert-SkillRef -SkillId $evo.new -SkillLookup $skillLookup
            }
        }

        $items += [ordered]@{
            id = [string]$card.card_id
            card_id = [int]$card.card_id
            base_character_id = [int]$card.char_id
            url_name = $card.url_name
            base_url_name = if ($null -ne $base) { $base.url_name } else { $null }
            name = Coalesce @($card.name_en, $card.name_jp)
            names = [ordered]@{
                en = $card.name_en
                ja = $card.name_jp
                ko = $card.name_ko
                zh_tw = $card.name_tw
            }
            variant = $card.title_en_gl
            titles = [ordered]@{
                en = $card.title_en_gl
                ja = $card.title_jp
                ko = $card.title_ko
                zh_tw = $card.title_tw
            }
            rarity = [int]$card.rarity
            obtained = $card.obtained
            release = [ordered]@{
                jp = $card.release
                en = $card.release_en
                ko = $card.release_ko
                zh_tw = $card.release_zh_tw
            }
            assets = [ordered]@{
                portrait = New-AssetDescriptor -Config $Config -AssetKey 'character_portrait' -Tokens @{
                    base_character_id = [int]$card.char_id
                    card_id = [int]$card.card_id
                } -Alt ('{0} {1}' -f (Coalesce @($card.name_en, $card.name_jp)), (Coalesce @($card.title_en_gl, $card.title_jp, 'portrait')))
            }
            aptitudes = [ordered]@{
                surface = $surface
                distance = $distance
                style = $style
            }
            viable_aptitudes = [ordered]@{
                surface = @(Get-ViableAptitudes -Map $surface)
                distance = @(Get-ViableAptitudes -Map $distance)
                style = @(Get-ViableAptitudes -Map $style)
            }
            stat_bonus = [ordered]@{
                speed = $card.stat_bonus[0]
                stamina = $card.stat_bonus[1]
                power = $card.stat_bonus[2]
                guts = $card.stat_bonus[3]
                wit = $card.stat_bonus[4]
            }
            stats = [ordered]@{
                base = [ordered]@{
                    speed = $card.base_stats[0]
                    stamina = $card.base_stats[1]
                    power = $card.base_stats[2]
                    guts = $card.base_stats[3]
                    wit = $card.base_stats[4]
                }
                four_star = [ordered]@{
                    speed = $card.four_star_stats[0]
                    stamina = $card.four_star_stats[1]
                    power = $card.four_star_stats[2]
                    guts = $card.four_star_stats[3]
                    wit = $card.four_star_stats[4]
                }
                five_star = [ordered]@{
                    speed = $card.five_star_stats[0]
                    stamina = $card.five_star_stats[1]
                    power = $card.five_star_stats[2]
                    guts = $card.five_star_stats[3]
                    wit = $card.five_star_stats[4]
                }
            }
            skill_links = [ordered]@{
                unique = Convert-SkillIdList -Ids $card.skills_unique -SkillLookup $skillLookup
                innate = Convert-SkillIdList -Ids $card.skills_innate -SkillLookup $skillLookup
                awakening = Convert-SkillIdList -Ids $card.skills_awakening -SkillLookup $skillLookup
                event = Convert-SkillIdList -Ids $card.skills_event -SkillLookup $skillLookup
                evolution = $skillsEvo
            }
            profile = [ordered]@{
                birthday = if ($null -ne $base) { Get-BirthdayString -Record $base } else { $null }
                height_cm = if ($null -ne $base) { $base.height } else { $null }
                measurements = if ($null -ne $base) { $base.three_sizes } else { $null }
                sex = if ($null -ne $base) { Get-SexLabel -Value $base.sex } else { $null }
                race = if ($null -ne $base) { $base.race } else { $null }
                playable = if ($null -ne $base) {
                    [ordered]@{
                        jp = [bool]$base.playable
                        en = [bool]$base.playable_en
                        ko = [bool]$base.playable_ko
                        zh_tw = [bool]$base.playable_zh_tw
                    }
                } else { $null }
                active = if ($null -ne $base) {
                    [ordered]@{
                        jp = [bool]$base.active
                        en = [bool]$base.active_en
                        ko = [bool]$base.active_ko
                        zh_tw = [bool]$base.active_zh_tw
                    }
                } else { $null }
                voice_actor = if ($null -ne $base) {
                    [ordered]@{
                        en = $base.va_en
                        ja = $base.va_ja
                        ko = $base.va_ko
                        zh_tw = $base.va_zh_tw
                        link = $base.va_link
                    }
                } else { $null }
                real_life = if ($null -ne $base) { $base.rl } else { $null }
            }
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'characters'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'characters'
        items = $items
    }
}

function Normalize-Supports {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$SupportCards,
        [Parameter(Mandatory = $true)]$SupportEffects,
        [Parameter(Mandatory = $true)]$Skills
    )

    $effectLookup = Build-Lookup -Items $SupportEffects -Property 'id'
    $skillLookup = Build-Lookup -Items $Skills -Property 'id'
    $items = @()

    foreach ($card in As-Array $SupportCards) {
        $hintOther = @()
        foreach ($hint in As-Array (Get-NamedValue -Container $card.hints -Name 'hint_others')) {
            $hintOther += [ordered]@{
                hint_type = $hint.hint_type
                hint_value = $hint.hint_value
            }
        }

        $items += [ordered]@{
            id = [string]$card.support_id
            support_id = [int]$card.support_id
            character_id = [int]$card.char_id
            url_name = $card.url_name
            name = Coalesce @($card.char_name, $card.name_jp)
            names = [ordered]@{
                en = $card.char_name
                ja = $card.name_jp
                ko = $card.name_ko
                zh_tw = $card.name_tw
            }
            type = $card.type
            rarity = [int]$card.rarity
            obtained = $card.obtained
            release = [ordered]@{
                jp = $card.release
                en = $card.release_en
                ko = $card.release_ko
                zh_tw = $card.release_zh_tw
            }
            assets = [ordered]@{
                cover = New-AssetDescriptor -Config $Config -AssetKey 'support_cover' -Tokens @{
                    support_id = [int]$card.support_id
                } -Alt ('{0} support card illustration' -f (Coalesce @($card.char_name, $card.name_jp)))
                icon = New-AssetDescriptor -Config $Config -AssetKey 'support_icon' -Tokens @{
                    support_id = [int]$card.support_id
                } -Alt ('{0} support card icon' -f (Coalesce @($card.char_name, $card.name_jp)))
            }
            effects = Convert-SupportEffectEntries -RawEffects $card.effects -EffectLookup $effectLookup
            unique_effects = Convert-SupportUniqueEffects -Unique (Get-NamedValue -Container $card -Name 'unique') -EffectLookup $effectLookup
            unique_effect_unlock_level = if ($null -ne (Get-NamedValue -Container $card -Name 'unique')) { $card.unique.level } else { $null }
            hint_skills = Convert-SkillIdList -Ids (Get-NamedValue -Container $card.hints -Name 'hint_skills') -SkillLookup $skillLookup
            hint_other_effects = $hintOther
            event_skills = Convert-SkillIdList -Ids $card.event_skills -SkillLookup $skillLookup
        }
    }

    $effectCatalog = @()
    foreach ($effect in As-Array $SupportEffects) {
        $effectCatalog += [ordered]@{
            effect_id = [int]$effect.id
            name = Coalesce @($effect.name_en_eon, $effect.name_en, $effect.name_ja)
            description = Coalesce @($effect.desc_en_eon, $effect.desc_en, $effect.desc_ja)
            calc = $effect.calc
            symbol = $effect.symbol
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'supports'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'supports'
        effect_catalog = $effectCatalog
        items = $items
    }
}

function Normalize-Skills {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Skills,
        [Parameter(Mandatory = $true)]$SkillEffectValues,
        [Parameter(Mandatory = $true)]$SkillConditionValues
    )

    $items = @()
    foreach ($skill in As-Array $Skills) {
        $items += [ordered]@{
            id = [string]$skill.id
            skill_id = [int]$skill.id
            name = Coalesce @($skill.name_en, $skill.enname, $skill.jpname)
            names = [ordered]@{
                en = Coalesce @($skill.name_en, $skill.enname)
                ja = $skill.jpname
                ko = $skill.name_ko
                zh_tw = $skill.name_tw
            }
            rarity = [int]$skill.rarity
            cost = Coalesce @($skill.cost, $(Get-NamedValue -Container $skill.gene_version -Name 'cost'))
            icon_id = $skill.iconid
            assets = [ordered]@{
                icon = if ($null -ne $skill.iconid) {
                    New-AssetDescriptor -Config $Config -AssetKey 'skill_icon' -Tokens @{
                        icon_id = [int]$skill.iconid
                    } -Alt ('{0} icon' -f (Coalesce @($skill.name_en, $skill.enname, $skill.jpname)))
                } else { $null }
            }
            activation = $skill.activation
            type_tags = As-Array $skill.type
            localized_type_tags = if ($null -ne (Get-NamedValue -Container (Get-NamedValue -Container $skill.loc -Name 'en') -Name 'type')) {
                As-Array ((Get-NamedValue -Container $skill.loc -Name 'en').type)
            } else { @() }
            descriptions = [ordered]@{
                en = Coalesce @($skill.desc_en, $skill.endesc)
                ja = $skill.jpdesc
                ko = $skill.desc_ko
                zh_tw = $skill.desc_tw
            }
            related_character_ids = As-Array $skill.char
            versions = As-Array $skill.versions
            condition_groups = Convert-ConditionGroups -ConditionGroups $skill.condition_groups
            gene_version = if ($null -ne $skill.gene_version) {
                [ordered]@{
                    id = $skill.gene_version.id
                    name = Coalesce @($skill.gene_version.name_en, $skill.gene_version.jpname)
                    rarity = $skill.gene_version.rarity
                    cost = $skill.gene_version.cost
                    inherited = $skill.gene_version.inherited
                    parent_skill_ids = As-Array $skill.gene_version.parent_skills
                    descriptions = [ordered]@{
                        en = $skill.gene_version.desc_en
                        ja = $skill.gene_version.jpdesc
                        ko = $skill.gene_version.desc_ko
                        zh_tw = $skill.gene_version.desc_tw
                    }
                    condition_groups = Convert-ConditionGroups -ConditionGroups $skill.gene_version.condition_groups
                }
            } else { $null }
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'skills'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'skills'
        references = [ordered]@{
            effect_values = $SkillEffectValues
            condition_values = $SkillConditionValues
        }
        items = $items
    }
}

function Normalize-Races {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Races
    )

    $items = @()
    foreach ($race in As-Array $Races) {
        $trackId = [string]$race.track
        $factorSummary = @()
        if ($null -ne $race.factor) {
            if (-not [string]::IsNullOrWhiteSpace($race.factor.effect_1)) {
                $factorSummary += $race.factor.effect_1
            }
            if (-not [string]::IsNullOrWhiteSpace($race.factor.effect_2)) {
                $factorSummary += $race.factor.effect_2
            }
        }

        $items += [ordered]@{
            id = [string]$race.id
            race_instance_id = [int]$race.id
            race_id = [int]$race.race_id
            url_name = $race.url_name
            name = Coalesce @($race.name_en, $race.name_jp)
            names = [ordered]@{
                en = $race.name_en
                ja = $race.name_jp
                ko = $race.name_ko
                zh_tw = $race.name_tw
            }
            track_id = $trackId
            track_name = Get-TrackName -TrackId $trackId
            track_slug = Get-TrackSlug -TrackId $trackId
            course_id = [int]$race.course_id
            banner_id = [int]$race.banner_id
            assets = [ordered]@{
                banner = if ($null -ne $race.banner_id) {
                    New-AssetDescriptor -Config $Config -AssetKey 'race_banner' -Tokens @{
                        banner_id = [int]$race.banner_id
                    } -Alt ('{0} banner' -f (Coalesce @($race.name_en, $race.name_jp)))
                } else { $null }
            }
            surface = Get-TerrainLabel -Value $race.terrain
            surface_slug = Get-TerrainSlug -Value $race.terrain
            distance_m = [int]$race.distance
            distance_category = Get-DistanceCategoryLabel -Meters $race.distance
            distance_category_slug = Get-DistanceCategorySlug -Meters $race.distance
            direction = Get-DirectionLabel -Value $race.direction
            direction_slug = Get-DirectionSlug -Value $race.direction
            season = Get-SeasonLabel -Value $race.season
            season_slug = Get-SeasonSlug -Value $race.season
            time_of_day = Get-TimeOfDayLabel -Value $race.time
            time_of_day_slug = Get-TimeOfDaySlug -Value $race.time
            entries = [int]$race.entries
            grade_code = [int]$race.grade
            group_code = [int]$race.group
            grade = Get-RaceGradeLabel -Group $race.group -Grade $race.grade
            course_code = $race.course
            career_years = As-Array $race.list_ura
            factor_summary = $factorSummary
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'races'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'races'
        items = $items
    }
}

function Normalize-Racetracks {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Racetracks
    )

    $items = @()

    foreach ($track in As-Array $Racetracks) {
        $trackId = [string]$track.id
        foreach ($course in As-Array $track.courses) {
            $uphillCount = 0
            $downhillCount = 0
            foreach ($slope in As-Array $course.slopes) {
                if ([int]$slope.slope -gt 0) {
                    $uphillCount++
                }
                elseif ([int]$slope.slope -lt 0) {
                    $downhillCount++
                }
            }

            $items += [ordered]@{
                id = [string]$course.id
                course_id = [int]$course.id
                track_id = $trackId
                track_name = Get-TrackName -TrackId $trackId
                track_slug = Get-TrackSlug -TrackId $trackId
                surface = Get-TerrainLabel -Value $course.terrain
                surface_slug = Get-TerrainSlug -Value $course.terrain
                distance_category = Get-DistanceCategoryFromCode -Value $course.distance
                distance_category_slug = Get-DistanceCategorySlugFromCode -Value $course.distance
                length_m = [int]$course.length
                turn = Get-DirectionLabel -Value $course.turn
                turn_slug = Get-DirectionSlug -Value $course.turn
                layout = Get-CourseLayoutLabel -Value $course.inout
                layout_slug = Get-CourseLayoutSlug -Value $course.inout
                corner_count = (As-Array $course.corners).Count
                straight_count = (As-Array $course.straights).Count
                uphill_count = $uphillCount
                downhill_count = $downhillCount
                has_slopes = ((As-Array $course.slopes).Count -gt 0)
                position_keep_end = $course.positionKeepEnd
                stat_thresholds = As-Array $course.statThresholds
                phases = As-Array $course.phases
                corners = As-Array $course.corners
                straights = As-Array $course.straights
                laps = As-Array $course.laps
                slopes = As-Array $course.slopes
                overlaps = As-Array $course.overlaps
                no_mans_land = As-Array $course.noMansLand
                terrain_changes = As-Array $course.terrainChanges
                spurt_start = $course.spurtStart
            }
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'racetracks'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'racetracks'
        items = $items
    }
}

function Normalize-G1Factors {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Factors,
        [Parameter(Mandatory = $true)]$Races,
        [Parameter(Mandatory = $true)]$Skills
    )

    $skillLookup = Build-Lookup -Items $Skills -Property 'id'
    $racesByBaseId = Build-GroupLookup -Items $Races -Property 'race_id'
    $items = @()

    foreach ($factor in As-Array $Factors.race) {
        $relatedRaces = As-Array (Get-NamedValue -Container $racesByBaseId -Name ([string]$factor.race_id))
        $summary = @()
        $careerYears = @()
        $trackNames = @()
        $surfaces = @()
        $distanceCategories = @()
        $raceDetails = @()

        foreach ($race in $relatedRaces) {
            foreach ($year in As-Array $race.list_ura) {
                $careerYears += $year
            }

            $trackNames += Get-TrackName -TrackId ([string]$race.track)
            $surfaces += Get-TerrainSlug -Value $race.terrain
            $distanceCategories += Get-DistanceCategorySlug -Meters $race.distance

            $raceDetails += [ordered]@{
                race_instance_id = [int]$race.id
                name = Coalesce @($race.name_en, $race.name_jp)
                track_name = Get-TrackName -TrackId ([string]$race.track)
                surface = Get-TerrainLabel -Value $race.terrain
                distance_m = [int]$race.distance
                distance_category = Get-DistanceCategoryLabel -Meters $race.distance
                direction = Get-DirectionLabel -Value $race.direction
                season = Get-SeasonLabel -Value $race.season
                time_of_day = Get-TimeOfDayLabel -Value $race.time
                grade = Get-RaceGradeLabel -Group $race.group -Grade $race.grade
                url_name = $race.url_name
            }

            if ($null -ne $race.factor) {
                if (-not [string]::IsNullOrWhiteSpace($race.factor.effect_2)) {
                    $summary += $race.factor.effect_2
                }
                if (-not [string]::IsNullOrWhiteSpace($race.factor.effect_1)) {
                    $summary += $race.factor.effect_1
                }
            }
        }

        $effectDetails = @()
        foreach ($effect in As-Array $factor.effects) {
            $detail = [ordered]@{
                type = [int]$effect.type
                value_1 = As-Array $effect.value_1
                value_2 = As-Array $effect.value_2
            }

            if ([int]$effect.type -eq 41 -and (As-Array $effect.value_1).Count -gt 0) {
                $detail.skill = Convert-SkillRef -SkillId ((As-Array $effect.value_1)[0]) -SkillLookup $skillLookup
            }

            $effectDetails += $detail
        }

        $items += [ordered]@{
            id = [string]$factor.id
            factor_id = [string]$factor.id
            race_id = [string]$factor.race_id
            name = Coalesce @($factor.name_en, $factor.name_ja)
            names = [ordered]@{
                en = Coalesce @($factor.name_en, $factor.name_en_gl)
                ja = $factor.name_ja
                ko = $factor.name_ko
                zh_tw = $factor.name_zh_tw
            }
            effect_summary = @($summary | Sort-Object -Unique)
            effect_details = $effectDetails
            related_races = $raceDetails
            career_years = @($careerYears | Sort-Object -Unique)
            track_names = @($trackNames | Sort-Object -Unique)
            surfaces = @($surfaces | Sort-Object -Unique)
            distance_categories = @($distanceCategories | Sort-Object -Unique)
            factor_type = [int]$factor.type
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'g1_factors'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'g1_factors'
        items = $items
    }
}

function Normalize-Compatibility {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Relations,
        [Parameter(Mandatory = $true)]$RelationMembers,
        [Parameter(Mandatory = $true)]$BaseCharacters,
        [Parameter(Mandatory = $true)]$CharacterCards
    )

    $baseLookup = Build-Lookup -Items $BaseCharacters -Property 'char_id'
    $variantsByChar = Build-GroupLookup -Items $CharacterCards -Property 'char_id'
    $membersByType = @{}
    foreach ($member in As-Array $RelationMembers) {
        $type = [string]$member.relation_type
        if (-not $membersByType.ContainsKey($type)) {
            $membersByType[$type] = @()
        }
        $membersByType[$type] += [int]$member.chara_id
    }

    foreach ($type in @($membersByType.Keys)) {
        $membersByType[$type] = @($membersByType[$type] | Sort-Object -Unique)
    }

    $charGroups = @{}
    $pairMap = @{}

    foreach ($relation in As-Array $Relations) {
        $type = [string]$relation.relation_type
        $point = [int]$relation.relation_point
        $members = if ($membersByType.ContainsKey($type)) { $membersByType[$type] } else { @() }

        foreach ($charId in $members) {
            $key = [string]$charId
            if (-not $charGroups.ContainsKey($key)) {
                $charGroups[$key] = @()
            }

            $charGroups[$key] += [ordered]@{
                relation_type = $type
                relation_point = $point
                member_count = $members.Count
                other_character_ids = @($members | Where-Object { $_ -ne $charId })
            }
        }

        for ($i = 0; $i -lt $members.Count; $i++) {
            for ($j = $i + 1; $j -lt $members.Count; $j++) {
                $left = [string]$members[$i]
                $right = [string]$members[$j]
                if ([int]$left -gt [int]$right) {
                    $tmp = $left
                    $left = $right
                    $right = $tmp
                }

                $pairKey = '{0}|{1}' -f $left, $right
                if (-not $pairMap.ContainsKey($pairKey)) {
                    $pairMap[$pairKey] = [ordered]@{
                        left_character_id = $left
                        right_character_id = $right
                        base_points = 0
                        relation_types = @()
                    }
                }

                $pairMap[$pairKey].base_points += $point
                $pairMap[$pairKey].relation_types += $type
            }
        }
    }

    $pairsByChar = @{}
    foreach ($pairEntry in $pairMap.GetEnumerator()) {
        $pair = $pairEntry.Value
        $relationTypes = @($pair.relation_types | Sort-Object -Unique)

        foreach ($charId in @($pair.left_character_id, $pair.right_character_id)) {
            if (-not $pairsByChar.ContainsKey($charId)) {
                $pairsByChar[$charId] = @()
            }
        }

        $leftBase = Get-NamedValue -Container $baseLookup -Name $pair.left_character_id
        $rightBase = Get-NamedValue -Container $baseLookup -Name $pair.right_character_id

        $pairsByChar[$pair.left_character_id] += [ordered]@{
            character_id = [int]$pair.right_character_id
            name = if ($null -ne $rightBase) { Coalesce @($rightBase.en_name, $rightBase.jp_name) } else { $null }
            base_points = $pair.base_points
            shared_relation_count = $relationTypes.Count
            shared_relation_types = $relationTypes
            available_en = if ($null -ne $rightBase) { [bool]$rightBase.playable_en } else { $false }
        }

        $pairsByChar[$pair.right_character_id] += [ordered]@{
            character_id = [int]$pair.left_character_id
            name = if ($null -ne $leftBase) { Coalesce @($leftBase.en_name, $leftBase.jp_name) } else { $null }
            base_points = $pair.base_points
            shared_relation_count = $relationTypes.Count
            shared_relation_types = $relationTypes
            available_en = if ($null -ne $leftBase) { [bool]$leftBase.playable_en } else { $false }
        }
    }

    $allCharacterIds = @($charGroups.Keys + $pairsByChar.Keys | Sort-Object -Unique)
    $items = @()
    $maxBasePoints = 0

    foreach ($charId in $allCharacterIds) {
        $base = Get-NamedValue -Container $baseLookup -Name $charId
        $variants = As-Array (Get-NamedValue -Container $variantsByChar -Name $charId)
        $matches = As-Array (Get-NamedValue -Container $pairsByChar -Name $charId) | Sort-Object `
            @{ Expression = { $_.base_points }; Descending = $true }, `
            @{ Expression = { $_.name }; Descending = $false }
        $top = @($matches | Select-Object -First 25)

        if ($top.Count -gt 0 -and $top[0].base_points -gt $maxBasePoints) {
            $maxBasePoints = $top[0].base_points
        }

        $variantRefs = @()
        foreach ($variant in $variants) {
            $variantRefs += [ordered]@{
                card_id = [int]$variant.card_id
                name = Coalesce @($variant.name_en, $variant.name_jp)
                variant = $variant.title_en_gl
            }
        }

        $items += [ordered]@{
            id = [string]$charId
            character_id = [int]$charId
            name = if ($null -ne $base) { Coalesce @($base.en_name, $base.jp_name) } else { $null }
            names = if ($null -ne $base) {
                [ordered]@{
                    en = $base.en_name
                    ja = $base.jp_name
                    ko = $base.name_ko
                    zh_tw = $base.name_tw
                }
            } else { $null }
            available = if ($null -ne $base) {
                [ordered]@{
                    jp = [bool]$base.playable
                    en = [bool]$base.playable_en
                    ko = [bool]$base.playable_ko
                    zh_tw = [bool]$base.playable_zh_tw
                }
            } else { $null }
            variants = $variantRefs
            variant_count = $variantRefs.Count
            top_matches = $top
            relation_groups = @((As-Array (Get-NamedValue -Container $charGroups -Name $charId)) | Sort-Object `
                @{ Expression = { $_.relation_point }; Descending = $true }, `
                @{ Expression = { $_.member_count }; Descending = $true }, `
                @{ Expression = { $_.relation_type }; Descending = $false })
        }
    }

    [ordered]@{
        schema_version = $script:SchemaVersion
        entity = 'compatibility'
        generated_at = Get-NowIso
        source = New-SourceStamp -Config $Config -Metadata $Metadata -EntityKey 'compatibility'
        model = [ordered]@{
            pairwise_points_source = 'sum of shared succession_relation groups by base character id'
            g1_bonus_included = $false
            g1_bonus_reference = 'g1_factors'
            version_rule = 'character versions do not change compatibility; base character ids are used'
            max_pairwise_points = $maxBasePoints
        }
        items = $items
    }
}

function Build-NormalizedReference {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Metadata
    )

    $raw = [ordered]@{
        characters = Load-RawDatasetByKey -Metadata $Metadata -Key 'characters'
        character_cards = Load-RawDatasetByKey -Metadata $Metadata -Key 'character-cards'
        support_cards = Load-RawDatasetByKey -Metadata $Metadata -Key 'support-cards'
        support_effects = Load-RawDatasetByKey -Metadata $Metadata -Key 'support_effects'
        skills = Load-RawDatasetByKey -Metadata $Metadata -Key 'skills'
        skill_effect_values = Load-RawDatasetByKey -Metadata $Metadata -Key 'static/skill_effect_values'
        skill_condition_values = Load-RawDatasetByKey -Metadata $Metadata -Key 'static/skill_condition_values'
        races = Load-RawDatasetByKey -Metadata $Metadata -Key 'races'
        racetracks = Load-RawDatasetByKey -Metadata $Metadata -Key 'racetracks'
        factors = Load-RawDatasetByKey -Metadata $Metadata -Key 'factors'
        succession_relation = Load-RawDatasetByKey -Metadata $Metadata -Key 'db-files/succession_relation'
        succession_relation_member = Load-RawDatasetByKey -Metadata $Metadata -Key 'db-files/succession_relation_member'
    }

    [ordered]@{
        characters = Normalize-Characters -Config $Config -Metadata $Metadata -BaseCharacters $raw.characters -CharacterCards $raw.character_cards -Skills $raw.skills
        supports = Normalize-Supports -Config $Config -Metadata $Metadata -SupportCards $raw.support_cards -SupportEffects $raw.support_effects -Skills $raw.skills
        skills = Normalize-Skills -Config $Config -Metadata $Metadata -Skills $raw.skills -SkillEffectValues $raw.skill_effect_values -SkillConditionValues $raw.skill_condition_values
        races = Normalize-Races -Config $Config -Metadata $Metadata -Races $raw.races
        racetracks = Normalize-Racetracks -Config $Config -Metadata $Metadata -Racetracks $raw.racetracks
        g1_factors = Normalize-G1Factors -Config $Config -Metadata $Metadata -Factors $raw.factors -Races $raw.races -Skills $raw.skills
        compatibility = Normalize-Compatibility -Config $Config -Metadata $Metadata -Relations $raw.succession_relation -RelationMembers $raw.succession_relation_member -BaseCharacters $raw.characters -CharacterCards $raw.character_cards
    }
}

function Save-NormalizedReference {
    param([Parameter(Mandatory = $true)]$Normalized)

    $normalizedRoot = Join-Path $script:ProjectRoot 'data/normalized'
    Ensure-Directory -Path $normalizedRoot

    $referenceMeta = [ordered]@{
        schema_version = $script:SchemaVersion
        generated_at = Get-NowIso
        entities = [ordered]@{}
    }

    foreach ($entityName in $Normalized.Keys) {
        $dataset = $Normalized[$entityName]
        Write-JsonFile -Path (Join-Path $normalizedRoot ("{0}.json" -f $entityName)) -Object $dataset
        $referenceMeta.entities[$entityName] = [ordered]@{
            count = (As-Array $dataset.items).Count
            source = $dataset.source
        }
    }

    Write-JsonFile -Path (Join-Path $normalizedRoot 'reference-meta.json') -Object $referenceMeta
}

function Get-AssetMapEntries {
    param($AssetMap)

    $entries = @()
    if ($null -eq $AssetMap) {
        return $entries
    }

    if ($AssetMap -is [System.Collections.IDictionary]) {
        foreach ($key in $AssetMap.Keys) {
            $entries += [ordered]@{
                key = [string]$key
                value = $AssetMap[$key]
            }
        }
        return $entries
    }

    foreach ($property in $AssetMap.PSObject.Properties) {
        $entries += [ordered]@{
            key = [string]$property.Name
            value = $property.Value
        }
    }

    $entries
}

function Get-NormalizedAssetCatalog {
    param([Parameter(Mandatory = $true)]$Normalized)

    $catalog = @{}

    foreach ($entityName in $Normalized.Keys) {
        $dataset = $Normalized[$entityName]
        foreach ($item in As-Array $dataset.items) {
            foreach ($assetEntry in Get-AssetMapEntries -AssetMap (Get-NamedValue -Container $item -Name 'assets')) {
                $asset = $assetEntry.value
                if ($null -eq $asset) {
                    continue
                }

                $relativePath = [string](Get-NamedValue -Container $asset -Name 'relative_path')
                $sourceUrl = [string](Get-NamedValue -Container $asset -Name 'source_url')
                if ([string]::IsNullOrWhiteSpace($relativePath) -or [string]::IsNullOrWhiteSpace($sourceUrl)) {
                    continue
                }

                $assetKey = $relativePath -replace '\\', '/'
                if (-not $catalog.ContainsKey($assetKey)) {
                    $catalog[$assetKey] = [ordered]@{
                        key = $assetKey
                        role = Get-NamedValue -Container $asset -Name 'role'
                        type = Get-NamedValue -Container $asset -Name 'type'
                        relative_path = $assetKey
                        source_url = $sourceUrl
                        content_type = Get-NamedValue -Container $asset -Name 'content_type'
                        alt = Get-NamedValue -Container $asset -Name 'alt'
                        owners = @()
                    }
                }

                $catalog[$assetKey].owners += [ordered]@{
                    entity = $entityName
                    item_id = [string]$item.id
                    slot = $assetEntry.key
                }
            }
        }
    }

    $catalog
}

function Sync-ReferenceAssets {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Normalized,
        [switch]$Force
    )

    $rawAssetRoot = Join-Path $script:ProjectRoot 'data/raw/assets/umamusume'
    Ensure-Directory -Path $rawAssetRoot

    $existingMetadata = Get-ExistingAssetMetadata
    $catalog = Get-NormalizedAssetCatalog -Normalized $Normalized
    $assetEntries = [ordered]@{}
    $downloadedCount = 0
    $reusedCount = 0
    $staleCount = 0
    $failedCount = 0

    foreach ($assetKey in ($catalog.Keys | Sort-Object)) {
        $asset = $catalog[$assetKey]
        $relativePath = $asset.relative_path -replace '/', [System.IO.Path]::DirectorySeparatorChar
        $localPath = Join-Path $rawAssetRoot $relativePath
        $previous = Get-NamedValue -Container $existingMetadata.assets -Name $assetKey
        $checkedAt = Get-NowIso
        $downloadedAt = if ($null -ne $previous) { $previous.downloaded_at } else { $null }
        $status = 'reused'
        $errorMessage = $null
        $sizeBytes = $null

        $shouldDownload = $Force -or -not (Test-Path -LiteralPath $localPath)

        if ($shouldDownload) {
            try {
                Write-Host ("Syncing asset {0}..." -f $assetKey)
                $bytes = Invoke-RemoteBinary -Url $asset.source_url
                Write-BinaryFile -Path $localPath -Bytes $bytes
                $downloadedAt = Get-NowIso
                $status = 'downloaded'
                $sizeBytes = $bytes.Length
                $downloadedCount++
            }
            catch {
                $errorMessage = $_.Exception.Message
                if (Test-Path -LiteralPath $localPath) {
                    $status = 'stale'
                    $sizeBytes = (Get-Item -LiteralPath $localPath).Length
                    $staleCount++
                }
                else {
                    $status = 'failed'
                    $failedCount++
                }
            }
        }
        else {
            $status = 'reused'
            $reusedCount++
            $sizeBytes = (Get-Item -LiteralPath $localPath).Length
        }

        $assetEntries[$assetKey] = [ordered]@{
            key = $assetKey
            role = $asset.role
            type = $asset.type
            relative_path = $asset.relative_path
            source_url = $asset.source_url
            local_path = $localPath
            content_type = $asset.content_type
            alt = $asset.alt
            owners = $asset.owners
            downloaded_at = $downloadedAt
            checked_at = $checkedAt
            status = $status
            size_bytes = $sizeBytes
            error = $errorMessage
        }
    }

    $metadata = [ordered]@{
        schema_version = $script:SchemaVersion
        generated_at = Get-NowIso
        asset_base_url = $Config.assetBaseUrl
        asset_serve_base_path = $Config.assetServeBasePath
        counts = [ordered]@{
            total = $assetEntries.Count
            downloaded = $downloadedCount
            reused = $reusedCount
            stale = $staleCount
            failed = $failedCount
        }
        assets = $assetEntries
    }

    Write-JsonFile -Path (Get-AssetMetadataPath) -Object $metadata

    [ordered]@{
        metadata = $metadata
        assetRoot = $rawAssetRoot
    }
}

function Convert-AppAssetMap {
    param(
        [Parameter(Mandatory = $true)]$Config,
        $AssetMap
    )

    $result = [ordered]@{}
    foreach ($entry in Get-AssetMapEntries -AssetMap $AssetMap) {
        $asset = $entry.value
        if ($null -eq $asset) {
            continue
        }

        $relativePath = [string](Get-NamedValue -Container $asset -Name 'relative_path')
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            continue
        }

        $result[$entry.key] = [ordered]@{
            role = Get-NamedValue -Container $asset -Name 'role'
            type = Get-NamedValue -Container $asset -Name 'type'
            alt = Get-NamedValue -Container $asset -Name 'alt'
            src = Join-UrlPath -Base $Config.assetServeBasePath -Path ($relativePath -replace '\\', '/')
            source_url = Get-NamedValue -Container $asset -Name 'source_url'
        }
    }

    $result
}

function Join-SearchText {
    param([object[]]$Values)

    if ($null -eq $Values) {
        return ''
    }

    $parts = @()
    foreach ($value in $Values) {
        foreach ($entry in As-Array $value) {
            if ($entry -is [string]) {
                if (-not [string]::IsNullOrWhiteSpace($entry)) {
                    $parts += $entry.Trim()
                }
            }
            elseif ($null -ne $entry) {
                $parts += [string]$entry
            }
        }
    }

    ($parts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique) -join ' '
}

function Convert-DisplayLabel {
    param(
        [string]$Value,
        [hashtable]$Map
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ($null -ne $Map -and $Map.ContainsKey($Value)) {
        return [string]$Map[$Value]
    }

    $normalized = ($Value -replace '[_-]+', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $Value
    }

    [System.Globalization.CultureInfo]::InvariantCulture.TextInfo.ToTitleCase($normalized.ToLowerInvariant())
}

function Convert-DisplayLabelList {
    param(
        $Values,
        [hashtable]$Map
    )

    @(
        foreach ($value in As-Array $Values) {
            $label = Convert-DisplayLabel -Value ([string]$value) -Map $Map
            if (-not [string]::IsNullOrWhiteSpace($label)) {
                $label
            }
        }
    ) | Select-Object -Unique
}

function New-FilterDefinition {
    param(
        [string]$Key,
        [string]$Label,
        [hashtable]$OptionLabels = @{}
    )

    [ordered]@{
        key = $Key
        label = $Label
        optionLabels = $OptionLabels
    }
}

function Get-FilterOptions {
    param(
        [Parameter(Mandatory = $true)]$Items,
        [Parameter(Mandatory = $true)]$Definitions
    )

    $options = [ordered]@{}
    foreach ($definition in As-Array $Definitions) {
        $counts = @{}
        foreach ($item in As-Array $Items) {
            $values = As-Array (Get-NamedValue -Container $item.filters -Name $definition.key)
            foreach ($value in $values) {
                if ([string]::IsNullOrWhiteSpace([string]$value)) {
                    continue
                }

                $key = [string]$value
                if (-not $counts.ContainsKey($key)) {
                    $counts[$key] = 0
                }
                $counts[$key]++
            }
        }

        $optionList = @()
        foreach ($value in ($counts.Keys | Sort-Object)) {
            $label = if ($definition.optionLabels.ContainsKey($value)) { $definition.optionLabels[$value] } else { $value }
            $optionList += [ordered]@{
                value = $value
                label = $label
                count = $counts[$value]
            }
        }
        $options[$definition.key] = $optionList
    }
    $options
}

function New-AppEntity {
    param(
        [string]$Label,
        $Source,
        $Definitions,
        $Items,
        $Model = $null
    )

    [ordered]@{
        label = $Label
        source = $Source
        model = $Model
        filter_definitions = $Definitions
        filter_options = Get-FilterOptions -Items $Items -Definitions $Definitions
        items = $Items
    }
}

function Build-StaticAppPayload {
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)]$Normalized,
        $AssetMetadata = $null
    )

    $charactersDefs = @(
        (New-FilterDefinition -Key 'rarity' -Label 'Rarity' -OptionLabels @{ '1' = '1-star'; '2' = '2-star'; '3' = '3-star' }),
        (New-FilterDefinition -Key 'surface' -Label 'A Surface' -OptionLabels $script:AptitudeDisplayLabels),
        (New-FilterDefinition -Key 'distance' -Label 'A Distance' -OptionLabels $script:AptitudeDisplayLabels),
        (New-FilterDefinition -Key 'style' -Label 'A Style' -OptionLabels $script:AptitudeDisplayLabels),
        (New-FilterDefinition -Key 'availability_en' -Label 'EN Availability' -OptionLabels @{ 'available' = 'Available'; 'unreleased' = 'Unreleased' })
    )
    $supportsDefs = @(
        (New-FilterDefinition -Key 'type' -Label 'Type'),
        (New-FilterDefinition -Key 'rarity' -Label 'Rarity' -OptionLabels @{ '1' = 'R'; '2' = 'SR'; '3' = 'SSR' }),
        (New-FilterDefinition -Key 'obtained' -Label 'Obtained'),
        (New-FilterDefinition -Key 'availability_en' -Label 'EN Availability' -OptionLabels @{ 'available' = 'Available'; 'unreleased' = 'Unreleased' })
    )
    $skillsDefs = @(
        (New-FilterDefinition -Key 'rarity' -Label 'Rarity'),
        (New-FilterDefinition -Key 'type_tags' -Label 'Type Tags' -OptionLabels $script:SkillTagDisplayLabels),
        (New-FilterDefinition -Key 'has_cost' -Label 'Cost' -OptionLabels @{ 'yes' = 'Has cost'; 'no' = 'No cost' }),
        (New-FilterDefinition -Key 'character_specific' -Label 'Character Specific' -OptionLabels @{ 'yes' = 'Yes'; 'no' = 'No' })
    )
    $racesDefs = @(
        (New-FilterDefinition -Key 'track_name' -Label 'Track'),
        (New-FilterDefinition -Key 'surface' -Label 'Surface'),
        (New-FilterDefinition -Key 'distance' -Label 'Distance'),
        (New-FilterDefinition -Key 'direction' -Label 'Direction'),
        (New-FilterDefinition -Key 'season' -Label 'Season'),
        (New-FilterDefinition -Key 'time_of_day' -Label 'Time'),
        (New-FilterDefinition -Key 'grade' -Label 'Grade')
    )
    $racetracksDefs = @(
        (New-FilterDefinition -Key 'track_name' -Label 'Track'),
        (New-FilterDefinition -Key 'surface' -Label 'Surface'),
        (New-FilterDefinition -Key 'distance' -Label 'Distance'),
        (New-FilterDefinition -Key 'turn' -Label 'Turn'),
        (New-FilterDefinition -Key 'layout' -Label 'Layout'),
        (New-FilterDefinition -Key 'has_slopes' -Label 'Slopes' -OptionLabels @{ 'yes' = 'Has slopes'; 'no' = 'No slopes' })
    )
    $g1Defs = @(
        (New-FilterDefinition -Key 'track_name' -Label 'Track'),
        (New-FilterDefinition -Key 'surface' -Label 'Surface'),
        (New-FilterDefinition -Key 'distance' -Label 'Distance'),
        (New-FilterDefinition -Key 'effect' -Label 'Effect')
    )
    $compatDefs = @(
        (New-FilterDefinition -Key 'availability_en' -Label 'EN Availability' -OptionLabels @{ 'available' = 'Available'; 'unreleased' = 'Unreleased' }),
        (New-FilterDefinition -Key 'score_band' -Label 'Top Match Score')
    )

    $charactersItems = foreach ($item in As-Array $Normalized.characters.items) {
        $characterBadgeLabels = Convert-DisplayLabelList -Values (
            @($item.viable_aptitudes.surface) +
            @($item.viable_aptitudes.distance) +
            @($item.viable_aptitudes.style)
        ) -Map $script:AptitudeDisplayLabels
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = '{0} | {1}-star' -f $item.variant, $item.rarity
            media = Convert-AppAssetMap -Config $Config -AssetMap $item.assets
            badges = @($characterBadgeLabels)
            search_text = Join-SearchText @($item.name, $item.names.en, $item.names.ja, $item.variant, $item.titles.en, $characterBadgeLabels)
            filters = [ordered]@{
                rarity = [string]$item.rarity
                surface = @($item.viable_aptitudes.surface)
                distance = @($item.viable_aptitudes.distance)
                style = @($item.viable_aptitudes.style)
                availability_en = if ($null -ne $item.release.en) { 'available' } else { 'unreleased' }
            }
            detail = $item
        }
    }
    $supportsItems = foreach ($item in As-Array $Normalized.supports.items) {
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = '{0} | {1}' -f $item.type, @('R', 'SR', 'SSR')[[int]$item.rarity - 1]
            media = Convert-AppAssetMap -Config $Config -AssetMap $item.assets
            badges = @((As-Array $item.effects | Select-Object -First 4 | ForEach-Object { $_.name }))
            search_text = Join-SearchText @($item.name, $item.names.ja, $item.type, $item.obtained, @($item.hint_skills.name))
            filters = [ordered]@{
                type = $item.type
                rarity = [string]$item.rarity
                obtained = $item.obtained
                availability_en = if ($null -ne $item.release.en) { 'available' } else { 'unreleased' }
            }
            detail = $item
        }
    }
    $skillsItems = foreach ($item in As-Array $Normalized.skills.items) {
        $skillBadgeLabels = Convert-DisplayLabelList -Values ($item.type_tags | Select-Object -First 4) -Map $script:SkillTagDisplayLabels
        $skillSearchLabels = Convert-DisplayLabelList -Values $item.type_tags -Map $script:SkillTagDisplayLabels
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = 'Rarity {0}{1}' -f $item.rarity, $(if ($null -ne $item.cost) { " | Cost $($item.cost)" } else { '' })
            media = Convert-AppAssetMap -Config $Config -AssetMap $item.assets
            badges = @($skillBadgeLabels)
            search_text = Join-SearchText @($item.name, $item.names.ja, $item.descriptions.en, $item.type_tags, $item.localized_type_tags, $skillSearchLabels)
            filters = [ordered]@{
                rarity = [string]$item.rarity
                type_tags = $item.type_tags
                has_cost = if ($null -ne $item.cost) { 'yes' } else { 'no' }
                character_specific = if ((As-Array $item.related_character_ids).Count -gt 0) { 'yes' } else { 'no' }
            }
            detail = $item
        }
    }
    $racesItems = foreach ($item in As-Array $Normalized.races.items) {
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = '{0} | {1} | {2}m' -f $item.track_name, $item.grade, $item.distance_m
            media = Convert-AppAssetMap -Config $Config -AssetMap $item.assets
            badges = @($item.surface, $item.distance_category, $item.direction)
            search_text = Join-SearchText @($item.name, $item.names.ja, $item.track_name, $item.grade, $item.factor_summary)
            filters = [ordered]@{
                track_name = $item.track_name
                surface = $item.surface
                distance = $item.distance_category
                direction = $item.direction
                season = $item.season
                time_of_day = $item.time_of_day
                grade = $item.grade
            }
            detail = $item
        }
    }
    $racetracksItems = foreach ($item in As-Array $Normalized.racetracks.items) {
        [ordered]@{
            id = $item.id
            title = '{0} #{1}' -f $item.track_name, $item.course_id
            subtitle = '{0} | {1} | {2}m' -f $item.surface, $item.distance_category, $item.length_m
            badges = @($item.turn, $item.layout, ('Corners {0}' -f $item.corner_count))
            search_text = Join-SearchText @($item.track_name, $item.course_id, $item.surface, $item.distance_category, $item.turn, $item.layout)
            filters = [ordered]@{
                track_name = $item.track_name
                surface = $item.surface
                distance = $item.distance_category
                turn = $item.turn
                layout = $item.layout
                has_slopes = if ($item.has_slopes) { 'yes' } else { 'no' }
            }
            detail = $item
        }
    }
    $g1Items = foreach ($item in As-Array $Normalized.g1_factors.items) {
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = 'Race spark | Race ID {0}' -f $item.race_id
            badges = @($item.effect_summary | Select-Object -First 3)
            search_text = Join-SearchText @($item.name, $item.names.ja, $item.effect_summary, $item.track_names)
            filters = [ordered]@{
                track_name = $item.track_names
                surface = $item.surfaces
                distance = $item.distance_categories
                effect = $item.effect_summary
            }
            detail = $item
        }
    }
    $compatItems = foreach ($item in As-Array $Normalized.compatibility.items) {
        $topScore = if ((As-Array $item.top_matches).Count -gt 0) { [int]$item.top_matches[0].base_points } else { 0 }
        $scoreBand = if ($topScore -ge 20) { '20+' } elseif ($topScore -ge 15) { '15-19' } elseif ($topScore -ge 10) { '10-14' } else { '0-9' }
        [ordered]@{
            id = $item.id
            title = $item.name
            subtitle = 'Variants {0} | Best base score {1}' -f $item.variant_count, $topScore
            badges = @($scoreBand)
            search_text = Join-SearchText @($item.name, $item.names.ja, @($item.variants.variant))
            filters = [ordered]@{
                availability_en = if ($item.available.en) { 'available' } else { 'unreleased' }
                score_band = $scoreBand
            }
            detail = $item
        }
    }

    [ordered]@{
        reference = [ordered]@{
            schema_version = $script:SchemaVersion
            generated_at = Get-NowIso
            assets = [ordered]@{
                local_base_path = $Config.assetServeBasePath
                count = if ($null -ne $AssetMetadata) { $AssetMetadata.counts.total } else { 0 }
                downloaded = if ($null -ne $AssetMetadata) { $AssetMetadata.counts.downloaded } else { 0 }
                reused = if ($null -ne $AssetMetadata) { $AssetMetadata.counts.reused } else { 0 }
                stale = if ($null -ne $AssetMetadata) { $AssetMetadata.counts.stale } else { 0 }
                failed = if ($null -ne $AssetMetadata) { $AssetMetadata.counts.failed } else { 0 }
                synced_at = if ($null -ne $AssetMetadata) { $AssetMetadata.generated_at } else { $null }
            }
            entities = [ordered]@{
                characters = [ordered]@{ count = $charactersItems.Count; imported_at = $Normalized.characters.source.imported_at }
                supports = [ordered]@{ count = $supportsItems.Count; imported_at = $Normalized.supports.source.imported_at }
                skills = [ordered]@{ count = $skillsItems.Count; imported_at = $Normalized.skills.source.imported_at }
                races = [ordered]@{ count = $racesItems.Count; imported_at = $Normalized.races.source.imported_at }
                racetracks = [ordered]@{ count = $racetracksItems.Count; imported_at = $Normalized.racetracks.source.imported_at }
                g1_factors = [ordered]@{ count = $g1Items.Count; imported_at = $Normalized.g1_factors.source.imported_at }
                compatibility = [ordered]@{ count = $compatItems.Count; imported_at = $Normalized.compatibility.source.imported_at }
            }
        }
        entities = [ordered]@{
            characters = New-AppEntity -Label 'Characters' -Source $Normalized.characters.source -Definitions $charactersDefs -Items $charactersItems
            supports = New-AppEntity -Label 'Supports' -Source $Normalized.supports.source -Definitions $supportsDefs -Items $supportsItems
            skills = New-AppEntity -Label 'Skills' -Source $Normalized.skills.source -Definitions $skillsDefs -Items $skillsItems
            races = New-AppEntity -Label 'Races' -Source $Normalized.races.source -Definitions $racesDefs -Items $racesItems
            racetracks = New-AppEntity -Label 'Racetracks' -Source $Normalized.racetracks.source -Definitions $racetracksDefs -Items $racetracksItems
            g1_factors = New-AppEntity -Label 'G1 Factors' -Source $Normalized.g1_factors.source -Definitions $g1Defs -Items $g1Items
            compatibility = New-AppEntity -Label 'Compatibility' -Source $Normalized.compatibility.source -Definitions $compatDefs -Items $compatItems -Model $Normalized.compatibility.model
        }
    }
}

function Save-StaticApp {
    param(
        [Parameter(Mandatory = $true)]$Payload,
        $AssetMetadata = $null
    )

    $distRoot = Join-Path $script:ProjectRoot 'dist'
    $distAssets = Join-Path $distRoot 'assets'
    $distData = Join-Path $distRoot 'data'
    $distMedia = Join-Path $distRoot 'media/reference'
    Ensure-Directory -Path $distRoot
    Ensure-Directory -Path $distAssets
    Ensure-Directory -Path $distData
    Ensure-Directory -Path $distMedia

    $uiRoot = Join-Path $script:ProjectRoot 'src/ui'
    Write-Utf8File -Path (Join-Path $distRoot 'index.html') -Content (Get-Content -LiteralPath (Join-Path $uiRoot 'index.html') -Raw -Encoding UTF8) -WithBom
    Write-Utf8File -Path (Join-Path $distAssets 'app.css') -Content (Get-Content -LiteralPath (Join-Path $uiRoot 'assets/app.css') -Raw -Encoding UTF8) -WithBom
    Write-Utf8File -Path (Join-Path $distAssets 'app.js') -Content (Get-Content -LiteralPath (Join-Path $uiRoot 'assets/app.js') -Raw -Encoding UTF8) -WithBom

    if ($null -ne $AssetMetadata) {
        foreach ($assetEntry in Get-AssetMapEntries -AssetMap $AssetMetadata.assets) {
            $asset = $assetEntry.value
            if ($null -eq $asset -or -not (Test-Path -LiteralPath $asset.local_path)) {
                continue
            }

            $relativePath = $asset.relative_path -replace '/', [System.IO.Path]::DirectorySeparatorChar
            $distPath = Join-Path $distMedia $relativePath
            Ensure-Directory -Path (Split-Path -Parent $distPath)
            Copy-Item -LiteralPath $asset.local_path -Destination $distPath -Force
        }
    }

    Write-JsonFile -Path (Join-Path $distData 'reference-meta.json') -Object $Payload.reference

    $legacyJsonPath = Join-Path $distData 'reference-data.json'
    if (Test-Path -LiteralPath $legacyJsonPath) {
        Remove-Item -LiteralPath $legacyJsonPath -Force
    }

    $payloadJson = $Payload | ConvertTo-Json -Depth 100 -Compress
    Write-Utf8File -Path (Join-Path $distData 'reference-data.js') -Content ("window.UMA_REFERENCE_DATA = {0};" -f $payloadJson) -WithBom
}

function Update-UmamusumeReference {
    param([switch]$Force)

    Write-Host 'Step 1/4: syncing raw GameTora datasets...'
    $sync = Sync-ReferenceRawData -Force:$Force

    Write-Host 'Step 2/4: normalizing local reference schemas...'
    $normalized = Build-NormalizedReference -Config $sync.config -Metadata $sync.metadata
    Save-NormalizedReference -Normalized $normalized

    Write-Host 'Step 3/4: syncing local visual assets...'
    $assetSync = Sync-ReferenceAssets -Config $sync.config -Normalized $normalized -Force:$Force

    Write-Host 'Step 4/4: building static local app bundle...'
    $payload = Build-StaticAppPayload -Config $sync.config -Normalized $normalized -AssetMetadata $assetSync.metadata
    Save-StaticApp -Payload $payload -AssetMetadata $assetSync.metadata

    [ordered]@{
        rawDatasetCount = (As-Array $sync.config.datasets).Count
        normalizedEntityCount = $normalized.Keys.Count
        assetCount = $assetSync.metadata.counts.total
        assetFailureCount = $assetSync.metadata.counts.failed
        appEntry = Join-Path $script:ProjectRoot 'dist/index.html'
    }
}
