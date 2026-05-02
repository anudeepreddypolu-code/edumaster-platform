import 'package:flutter/material.dart';

void main() {
  runApp(const EduMasterImprovedApp());
}

class EduMasterImprovedApp extends StatelessWidget {
  const EduMasterImprovedApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'EduMaster UI Reference',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF149ED1)),
      ),
      home: const Scaffold(
        body: Center(
          child: Text(
            'Run qa-automation/src/runner.ts to generate a fresh improved_ui.dart from the latest QA/UX findings.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
