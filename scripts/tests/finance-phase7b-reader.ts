// Laboratorio de SOLO LECTURA para analizar el Excel real del propietario.
// Nunca importa ni escribe nada; solo expone readFinanceWorkbook al CDP.
import {readFinanceWorkbook, listWorkbookSheetNames} from '../../src/lib/financeReconciliation';
Object.assign(window, {financeReader: {readFinanceWorkbook, listWorkbookSheetNames, ready: true}});
