"""Compara todas las filas/campos de COPY original y restaurado. Nunca imprime datos.
Solo normaliza números mediante igualdad Decimal exacta; ningún margen de error.
"""
import pathlib, json, re, decimal, hashlib, sys
root = pathlib.Path(sys.argv[1])
meta = json.loads((root / 'column-types.json').read_text(encoding='utf8-sig'))
tables = {}; current = None
for line in (root / 'archive-data.sql').read_text(encoding='utf8').splitlines():
    match = re.fullmatch(r'COPY public\.(clients|service_contracts|installations) \((.+)\) FROM stdin;', line)
    if match:
        current = match[1]
        columns = [name.strip().strip('"') for name in match[2].split(',')]
        assert columns == [col['name'] for col in meta[current]], 'COLUMN_ORDER_MISMATCH'
        tables[current] = []
    elif current and line == r'\.': current = None
    elif current: tables[current].append(line.split('\t'))
assert set(tables) == {'clients', 'service_contracts', 'installations'}
result = {}
for table, source in tables.items():
    restored = [line.split('\t') for line in (root / ('restored-' + table + '.copy')).read_text(encoding='utf8').splitlines()]
    source.sort(key=lambda row: row[0]); restored.sort(key=lambda row: row[0])
    assert len(source) == len(restored), 'ROW_COUNT_MISMATCH'
    representation = {}; canonical = []
    for left, right in zip(source, restored):
        assert len(left) == len(right) == len(meta[table]), 'COLUMN_COUNT_MISMATCH'
        normalized = []
        for index, (a, b) in enumerate(zip(left, right)):
            col = meta[table][index]
            if a != b:
                assert col['type'] in ('numeric', 'decimal', 'double precision', 'real'), 'NON_NUMERIC_VALUE_MISMATCH'
                assert decimal.Decimal(a) == decimal.Decimal(b), 'NUMERIC_VALUE_MISMATCH'
                representation[col['name']] = representation.get(col['name'], 0) + 1
            normalized.append(a)
        canonical.append(normalized)
    result[table] = {'rows': len(source), 'allFieldsEqual': True, 'numericRepresentationDifferences': representation,
                     'archiveCopySha256': hashlib.sha256(json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()}
report = {'status': 'PASS', 'allRowsAndFieldsCompared': True, 'numericComparison': 'exact Decimal equality; no tolerance', 'tables': result, 'productionAccess': False}
(root / 'copy-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps(report))
