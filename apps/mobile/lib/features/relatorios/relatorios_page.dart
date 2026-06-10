import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../shared/widgets/placeholder_tab.dart';

// Placeholder — reportes fiscais são Marco 2, não implementados aqui.
class RelatoriosPage extends StatelessWidget {
  const RelatoriosPage({super.key});

  @override
  Widget build(BuildContext context) {
    return PlaceholderTab(
      title: AppLocalizations.of(context).relatorios,
      icon: Icons.bar_chart,
    );
  }
}
