import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// The Library page's PhotoGuesser entry.
///
/// Takes [onTap] rather than pushing the route itself: a widget test has no auto_route Router, so
/// `context.pushRoute` cannot be driven from one — keeping the push at the call site is what
/// leaves the rest of this card testable.
class PhotoGuesserCard extends StatelessWidget {
  const PhotoGuesserCard({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Same sizing as the collection cards it sits beside, so the Wrap lays out one even grid.
    return LayoutBuilder(
      builder: (context, constraints) {
        final isTablet = constraints.maxWidth > 600;
        final widthFactor = isTablet ? 0.25 : 0.5;
        final size = context.width * widthFactor - 20.0;

        return GestureDetector(
          key: const Key('library-photoguesser-card'),
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: size,
                width: size,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.all(Radius.circular(20)),
                    gradient: LinearGradient(
                      colors: [context.colorScheme.primary.withAlpha(30), context.colorScheme.primary.withAlpha(25)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                  ),
                  // An icon rather than the sibling cards' 2x2 thumbnail preview: this card opens
                  // a game, not a collection, and the only photos it could show belong to today's
                  // daily. Reaching for one would mean reading the daily endpoint from the Library
                  // page, and that read is what GENERATES the daily — scrolling past this card
                  // would burn the candidate queries and CLIP prompts for a game nobody opened.
                  child: Center(
                    child: Icon(Icons.travel_explore_outlined, size: 48, color: context.colorScheme.primary),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Text(
                  'photoguesser'.t(context: context),
                  style: context.textTheme.titleSmall?.copyWith(
                    color: context.colorScheme.onSurface,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
