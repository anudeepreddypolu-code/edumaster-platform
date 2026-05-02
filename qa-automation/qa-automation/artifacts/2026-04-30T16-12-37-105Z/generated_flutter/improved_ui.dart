import 'package:flutter/material.dart';

void main() {
  runApp(const VaronEnglishImprovedApp());
}

class VaronEnglishImprovedApp extends StatelessWidget {
  const VaronEnglishImprovedApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'VARONENGLISH Improved UI',
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF4F8FC),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF149ED1),
          brightness: Brightness.light,
        ),
        textTheme: ThemeData.light().textTheme.apply(
          bodyColor: const Color(0xFF132338),
          displayColor: const Color(0xFF132338),
        ),
      ),
      home: const ImprovedShell(),
    );
  }
}

class ImprovedShell extends StatefulWidget {
  const ImprovedShell({super.key});

  @override
  State<ImprovedShell> createState() => _ImprovedShellState();
}

class _ImprovedShellState extends State<ImprovedShell> {
  int currentIndex = 0;

  final screens = const [
    ImprovedDashboardScreen(),
    PlaceholderScreen(title: 'Courses'),
    PlaceholderScreen(title: 'Tests'),
    PlaceholderScreen(title: 'Live'),
    PlaceholderScreen(title: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: screens[currentIndex]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (index) => setState(() => currentIndex = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.menu_book_outlined), label: 'Courses'),
          NavigationDestination(icon: Icon(Icons.assignment_outlined), label: 'Tests'),
          NavigationDestination(icon: Icon(Icons.live_tv_outlined), label: 'Live'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}

class ImprovedDashboardScreen extends StatelessWidget {
  const ImprovedDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        decoration: InputDecoration(
                          hintText: 'Search lessons, tests, or live classes',
                          prefixIcon: const Icon(Icons.search),
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(18),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: const Color(0xFFE4F5FB),
                      child: const Icon(Icons.notifications_none),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(28),
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0F1B2E), Color(0xFF17355A)],
                    ),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Today\'s Mission', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600)),
                      SizedBox(height: 10),
                      Text('Finish one lecture, one quiz, and one revision block.', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                      SizedBox(height: 12),
                      Text('This layout keeps one primary action above the fold and reduces competing card weight.', style: TextStyle(color: Colors.white70, height: 1.5)),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                const Row(
                  children: [
                    Expanded(child: StatCard(label: 'Accuracy', value: '78%')),
                    SizedBox(width: 12),
                    Expanded(child: StatCard(label: 'Streak', value: '12d')),
                    SizedBox(width: 12),
                    Expanded(child: StatCard(label: 'Revision', value: '8')),
                  ],
                ),
                const SizedBox(height: 24),
                const Text('Design notes', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text(
                  'Generated from QA/UX analysis findings:',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF62748A)),
                ),
                const SizedBox(height: 8),
                Text(
                  '',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF62748A)),
                ),
              ],
            ),
          ),
        ),
        SliverList.list(
          children: const [
            SectionCard(
              title: 'Continue Learning',
              description: 'Large cards are replaced with cleaner grouped rows and better hierarchy.',
            ),
            SectionCard(
              title: 'Revision Queue',
              description: 'Saved topics and weak-topic recovery are merged into one focused area.',
            ),
            SectionCard(
              title: 'Upcoming Live Class',
              description: 'Live entry stays contextual instead of competing with every dashboard metric.',
            ),
          ],
        ),
      ],
    );
  }
}

class StatCard extends StatelessWidget {
  final String label;
  final String value;
  const StatCard({super.key, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF6A7B91))),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class SectionCard extends StatelessWidget {
  final String title;
  final String description;
  const SectionCard({super.key, required this.title, required this.description});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(description, style: const TextStyle(color: Color(0xFF6A7B91), height: 1.5)),
          ],
        ),
      ),
    );
  }
}

class PlaceholderScreen extends StatelessWidget {
  final String title;
  const PlaceholderScreen({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(title, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
    );
  }
}

// - Keep bottom navigation focused on 4-5 destinations and move secondary tools like revision and analytics into contextual entry points or a "More" surface.
// - Add skeleton loaders and preserve layout while data loads so transitions feel intentional instead of blocked.
// - Lead each screen with one primary action, one progress summary, and move secondary metrics below the fold.
// - Use quieter containers for supporting information, stronger section spacing, and one accent surface per screen.
