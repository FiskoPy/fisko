import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/config/env.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // A release APK built without --dart-define=API_BASE_URL keeps the emulator
  // default, which routes nowhere from a real phone. Every call then fails at
  // the socket and the app says "revisá tu internet" — sending the tester to
  // debug a connection that was never the problem. That shipped once. Say what
  // is actually wrong instead of letting it look like the network.
  if (kReleaseMode && Env.isLocalApiBase) {
    runApp(const _MisconfiguredApp());
    return;
  }

  runApp(const ProviderScope(child: FiskoApp()));
}

/// Shown only when a release build carries an unreachable API address. It is
/// aimed at whoever built the APK, not at the end user — but it has to be
/// legible to the tester holding the phone, because they are the one who will
/// read it out over WhatsApp.
class _MisconfiguredApp extends StatelessWidget {
  const _MisconfiguredApp();

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.build_circle_outlined, size: 56),
                SizedBox(height: 20),
                Text(
                  'Esta versión está mal compilada',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 12),
                Text(
                  'No apunta a ningún servidor, así que nada va a cargar. '
                  'No es tu internet. Pedí una versión nueva.',
                  textAlign: TextAlign.center,
                ),
                SizedBox(height: 20),
                SelectableText(
                  Env.apiBaseUrl,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, fontFamily: 'monospace'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
