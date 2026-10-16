# Validate local executor evidence. No SQL, credentials, network or retry.
function Get-Fase162InstallationResult([int]$exitCode,[string]$output) {
    $lines=@($output -split '\r?\n' | ForEach-Object {$_.Trim()} | Where-Object {$_})
    $markers=@('F162_GATE_PASSED','F162_BASELINE_END','F162_COMMIT_CONFIRMED','F162_POSTCHECKS_END','F162_AFTER_END')
    $positions=@($markers | ForEach-Object {[Array]::IndexOf($lines,$_ )})
    $gate=$positions[0] -ge 0
    $commit=$positions[2] -ge 0
    $status='BLOQUEADO_RESULTADO_INCOMPLETO'
    $valid=$exitCode -eq 0 -and -not ($lines -contains 'F162_ABORTED_UNSAFE')
    $last=-1
    foreach($marker in $markers){
        $pos=[Array]::IndexOf($lines,$marker)
        if($pos -le $last -or @($lines | Where-Object {$_ -ceq $marker}).Count -ne 1){$valid=$false}
        $last=$pos
    }
    if($valid){
        try {
            $before=@($lines[($positions[0]+1)..($positions[1]-1)] | Where-Object {$_.StartsWith('{')})
            $post=@($lines[($positions[2]+1)..($positions[3]-1)] | Where-Object {$_.StartsWith('{')})
            $after=@($lines[($positions[3]+1)..($positions[4]-1)] | Where-Object {$_.StartsWith('{')})
            if($before.Count -ne 1 -or $post.Count -ne 1 -or $after.Count -ne 1){throw 'Missing evidence'}
            $b=$before[0]|ConvertFrom-Json;$p=$post[0]|ConvertFrom-Json;$a=$after[0]|ConvertFrom-Json
            if($b.read_only -ne 'on' -or $a.read_only -ne 'on'){throw 'Snapshot not read only'}
            if(($b|ConvertTo-Json -Depth 50 -Compress) -cne ($a|ConvertTo-Json -Depth 50 -Compress)){throw 'Operational data changed'}
            if($p.stage -ne 'postchecks' -or @($p.rows).Count -lt 2){throw 'Missing postchecks'}
            $final=@($p.rows | Where-Object {$_.control -ceq 'RESULTADO FINAL'})
            if($final.Count -ne 1 -or $final[0].resultado -cne 'INSTALACION ESTRUCTURAL OK'){throw 'Final postcheck failed'}
            foreach($row in $p.rows){if($row.control -cne 'RESULTADO FINAL' -and $row.resultado -cne 'OK'){throw 'Postcheck failed'}}
            $status='INSTALACION_VERIFICADA'
        } catch {$valid=$false;$status='BLOQUEADO_VERIFICACION_POSTERIOR'}
    }
    if($lines -contains 'F162_ABORTED_UNSAFE'){
        $status=if($commit){'BLOQUEADO_EVIDENCIA_CONTRADICTORIA'}else{'BLOQUEADO_PRECHECK_SIN_INSTALACION'}
    }
    if($exitCode -ne 0){$status='BLOQUEADO_ERROR_SQL_O_TRANSPORTE'}
    [pscustomobject]@{status=$status;success=$valid;exitCode=$exitCode;gate=$gate;commitConfirmed=$commit;automaticRetry=$false;requiresReadOnlyInspection=(-not $valid -and $gate)}
}
