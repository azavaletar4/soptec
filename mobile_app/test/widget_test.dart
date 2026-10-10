import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:app/main.dart';

void main() {
  testWidgets('La app arranca y muestra el WebView del panel', (WidgetTester tester) async {
    await tester.pumpWidget(const SmartRaycoApp());
    // Antes de que el WebView termine de inicializar, se ve el indicador de carga.
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
