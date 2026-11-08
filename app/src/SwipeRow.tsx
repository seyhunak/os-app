import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { F, useColors } from './ui';

const ACTION_WIDTH = 96;
/** A swipe past this deletes without a second tap. */
const FULL_SWIPE = 200;

/**
 * A row you swipe left to reveal Delete, or swipe all the way to delete at once. Screen readers
 * get a Delete action instead, since they can't swipe.
 */
export function SwipeRow({ children, onPress, onDelete, label }: { children: ReactNode; onPress(): void; onDelete(): void; label: string }) {
  const c = useColors();
  const x = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const settle = (to: number) => Animated.spring(x, { toValue: to, useNativeDriver: false, bounciness: 0 }).start();

  const responder = useMemo(() => PanResponder.create({
    // Only clearly sideways moves, so the page still scrolls.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx + (open ? -ACTION_WIDTH : 0))),
    onPanResponderRelease: (_, g) => {
      const at = g.dx + (open ? -ACTION_WIDTH : 0);
      if (at < -FULL_SWIPE) {
        onDelete();
        return;
      }
      const reveal = at < -ACTION_WIDTH / 2;
      setOpen(reveal);
      settle(reveal ? -ACTION_WIDTH : 0);
    },
    onPanResponderTerminate: () => settle(open ? -ACTION_WIDTH : 0),
  }), [open, onDelete, x]);

  return (
    <View style={{ overflow: 'hidden', borderTopWidth: 1, borderColor: c.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${label}`}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        onPress={onDelete}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_WIDTH, backgroundColor: c.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: c.danger, fontFamily: F.sansBold, fontSize: 15 }}>Delete</Text>
      </Pressable>
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: x }], backgroundColor: c.bg }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Swipe left to delete"
          accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && onDelete()}
          onPress={() => {
            if (open) {
              setOpen(false);
              settle(0);
            } else onPress();
          }}
          style={{ minHeight: 48, justifyContent: 'center' }}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}
