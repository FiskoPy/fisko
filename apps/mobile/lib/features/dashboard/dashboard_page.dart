import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../../shared/widgets/placeholder_tab.dart';

// Placeholder — business logic is out of scope for Marco 1.
class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    return PlaceholderTab(
      title: AppLocalizations.of(context).dashboard,
      icon: Icons.home,
    );
  }
}
