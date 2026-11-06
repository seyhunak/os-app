import { Fragment, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { F, useColors } from './ui';

/** Inline bold and code only. Brief text can quote outside sources, so nothing here becomes a live link. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <Text key={i} style={{ fontFamily: F.bold }}>{part.slice(2, -2)}</Text>;
    if (part.startsWith('`') && part.endsWith('`')) return <Text key={i} style={{ fontFamily: F.bold }}>{part.slice(1, -1)}</Text>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isDivider = (row: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes('-');

export function Markdown({ source }: { source: string }) {
  const c = useColors();
  const blocks: ReactNode[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        if (!isDivider(lines[i]!)) rows.push(cells(lines[i]!));
        i++;
      }
      i--;
      blocks.push(
        <View key={i} style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}>
          {rows.map((row, r) => (
            <View key={r} style={{ flexDirection: 'row', borderTopWidth: r ? 1 : 0, borderColor: c.line, backgroundColor: 'transparent' }}>
              {row.map((cell, k) => (
                <Text key={k} style={{ flex: k === row.length - 1 ? 2 : 1, paddingVertical: 7, paddingRight: 8, color: c.text, fontFamily: r ? F.sans : F.sansBold, fontSize: 13, lineHeight: 18 }}>{inline(cell)}</Text>
              ))}
            </View>
          ))}
        </View>,
      );
    } else if (/^#{1,6}\s/.test(trimmed)) {
      const level = trimmed.match(/^#+/)![0].length;
      blocks.push(
        <Text key={i} accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: level === 1 ? 32 : 22, letterSpacing: level === 1 ? -0.4 : 0, marginTop: level === 1 ? 0 : 8 }}>
          {inline(trimmed.replace(/^#+\s*/, ''))}
        </Text>,
      );
    } else if (trimmed.startsWith('>')) {
      blocks.push(
        <View key={i} style={{ borderLeftWidth: 3, borderColor: c.accent, paddingLeft: 12 }}>
          <Text style={{ color: c.muted, fontFamily: F.italic, fontSize: 17, lineHeight: 25 }}>{inline(trimmed.replace(/^>\s*/, ''))}</Text>
        </View>,
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      blocks.push(
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 18, lineHeight: 26 }}>•</Text>
          <Text style={{ flex: 1, color: c.text, fontFamily: F.text, fontSize: 18, lineHeight: 26 }}>{inline(trimmed.replace(/^[-*]\s/, ''))}</Text>
        </View>,
      );
    } else {
      blocks.push(<Text key={i} style={{ color: c.text, fontFamily: F.text, fontSize: 18, lineHeight: 26 }}>{inline(trimmed)}</Text>);
    }
  }
  return <View style={{ gap: 10 }}>{blocks}</View>;
}
