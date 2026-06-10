import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../shared/widgets/placeholder_tab.dart';

// Placeholder — captura (DTE/OCR) is Marco 2, not implemented here.
class CapturaPage extends StatelessWidget {
  const CapturaPage({super.key});

  @override
  Widget build(BuildContext context) {
    return PlaceholderTab(
      title: AppLocalizations.of(context).captura,
      icon: Icons.camera_alt,
    );
  }
}
