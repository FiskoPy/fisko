import 'package:flutter/material.dart';

/// Skeleton scaffold for the Marco 1 placeholder tabs (no business logic yet).
class PlaceholderTab extends StatelessWidget {
  const PlaceholderTab({
    required this.title,
    required this.icon,
    this.actions,
    super.key,
  });

  final String title;
  final IconData icon;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              'Próximamente',
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          ],
        ),
      ),
    );
  }
}
