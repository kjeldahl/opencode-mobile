import { isValidElement, useMemo, type ReactNode } from "react"
import { Linking, View, Text, useColorScheme, Platform, type ImageStyle, type StyleProp, type ViewStyle, type TextStyle } from "react-native"
import { useMarkdown, Renderer } from "react-native-marked"
import { CodeBlock } from "./CodeBlock"
import { MarkdownImage, MarkdownImageStrip } from "./MarkdownImage"
import { GalleryContext, type GalleryItem } from "./gallery-context"

// Overrides react-native-marked's text nodes to tweak codespan styling and
// route fenced code to CodeBlock. All text stays `selectable` so assistant
// replies can be long-pressed and copied with the native selection menu.
// A paragraph's inline nodes nest inside one outer <Text>, so selection
// spans the whole paragraph (not across paragraphs).
// Previously dropped over facebook/react-native#46999 (selectable <Text> in
// Android FlatList rows); reported fixed on RN 0.81 + new arch, which we run.
function isImageElement(node: ReactNode): boolean {
  return isValidElement(node) && node.type === MarkdownImage
}

// Everything a tapped image's viewer needs, in document order: our image
// elements found inside the parsed blocks (strips contribute their row).
function collectImages(node: ReactNode): GalleryItem[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap((child) => collectImages(child))
  if (!isValidElement(node)) return []
  const props = node.props as { uri?: string; alt?: string; images?: { uri: string; alt?: string }[]; children?: ReactNode }
  if (node.type === MarkdownImage) return [{ raw: props.uri ?? "", alt: props.alt }]
  if (node.type === MarkdownImageStrip) return (props.images ?? []).map((i) => ({ raw: i.uri, alt: i.alt }))
  return collectImages(props.children)
}

class CustomRenderer extends Renderer {
  // Adjacent images (one Markdown paragraph, i.e. consecutive lines) render
  // as one horizontal strip instead of stacked blocks.
  paragraph(children: ReactNode[], styles?: ViewStyle): ReactNode {
    const flat = (Array.isArray(children) ? children : [children]).filter(Boolean) as ReactNode[]
    const images = flat.filter(isImageElement)
    if (images.length >= 2) {
      const rest = flat.filter((child) => !images.includes(child))
      return (
        <View key={this.getKey()} style={styles}>
          {rest}
          <MarkdownImageStrip images={images.map((el) => (el as { props: { uri: string; alt?: string } }).props)} />
        </View>
      )
    }
    return super.paragraph(children, styles)
  }

  private plainText(children: string | ReactNode[], styles?: StyleProp<TextStyle>): ReactNode {
    return (
      <Text key={this.getKey()} style={styles} selectable>
        {children}
      </Text>
    )
  }

  // Images get our own renderer: relative URLs (forge /__forge/file pattern)
  // resolve against the active connection with its auth header, foreign hosts
  // load without auth, and a tap opens the full-screen viewer.
  image(uri: string, alt?: string, _style?: ImageStyle, _title?: string): ReactNode {
    return <MarkdownImage key={this.getKey()} uri={uri} alt={alt} />
  }

  linkImage(href: string, imageUrl: string, alt?: string, _style?: ImageStyle, _title?: string): ReactNode {
    return <MarkdownImage key={this.getKey()} uri={imageUrl} alt={alt} onPress={() => Linking.openURL(href)} />
  }

  code(text: string, language?: string, containerStyle?: ViewStyle, _textStyle?: TextStyle) {
    return (
      <View key={this.getKey()} style={containerStyle}>
        <CodeBlock code={text} language={language} />
      </View>
    )
  }

  text(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(text, styles)
  }

  strong(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  em(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  del(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(children, styles)
  }

  heading(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    return this.plainText(text, styles)
  }

  codespan(text: string, styles?: TextStyle): ReactNode {
    return this.plainText(text, [styles, { fontStyle: "normal", fontWeight: "normal" }])
  }
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

const lightTheme = {
  text: { color: "#0a0a0a", fontSize: 15, lineHeight: 22 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  h1: { fontSize: 22, fontWeight: "700" as const, color: "#0a0a0a", marginBottom: 8, marginTop: 12 },
  h2: { fontSize: 19, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 6, marginTop: 10 },
  h3: { fontSize: 16, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 4, marginTop: 8 },
  link: { color: "#8b5cf6" },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 3,
    borderLeftColor: "#d1d5db",
    paddingLeft: 12,
    paddingVertical: 2,
    marginVertical: 4,
  },
  code: {
    backgroundColor: "#e8e5f0",
    color: "#6d28d9",
    fontFamily: mono,
    fontSize: 13,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  codespan: {
    backgroundColor: "#e8e5f0",
    color: "#6d28d9",
    fontFamily: mono,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  list: { marginBottom: 4 },
  li: { marginBottom: 2 },
  hr: { backgroundColor: "#e5e5e5", height: 1, marginVertical: 12 },
  strong: { fontWeight: "700" as const },
  em: { fontStyle: "italic" as const },
  strikethrough: { textDecorationLine: "line-through" as const },
  image: { borderRadius: 8 },
}

const darkTheme = {
  ...lightTheme,
  text: { ...lightTheme.text, color: "#e5e5e5" },
  h1: { ...lightTheme.h1, color: "#ffffff" },
  h2: { ...lightTheme.h2, color: "#ffffff" },
  h3: { ...lightTheme.h3, color: "#ffffff" },
  link: { color: "#a78bfa" },
  blockquote: {
    ...lightTheme.blockquote,
    borderLeftColor: "#4a4a5a",
  },
  code: {
    ...lightTheme.code,
    backgroundColor: "#2a2040",
    color: "#c4b5fd",
  },
  codespan: {
    ...lightTheme.codespan,
    backgroundColor: "#2a2040",
    color: "#c4b5fd",
  },
  hr: { ...lightTheme.hr, backgroundColor: "#2a2a2a" },
}

interface Props {
  children: string
}

export function Markdown({ children }: Props) {
  const isDark = useColorScheme() === "dark"
  const theme = isDark ? darkTheme : lightTheme

  // A module-scope singleton renderer would share one CustomRenderer (and
  // its underlying github-slugger) across every Markdown instance and every
  // streamed token forever. github-slugger never resets, so its heading-slug
  // keys only ever climb — which fed into useMarkdown's memoized parser and
  // made the emitted React keys change on every token, remounting the whole
  // subtree (resetting code-block scroll position, flashing content). Scoping
  // the renderer to `children` resets the slugger per parse, so keys are
  // deterministic (and stable) for a given value, while re-renders with an
  // unchanged value stay memoized instead of creating a new renderer.
  const renderer = useMemo(() => new CustomRenderer(), [children])

  // react-native-marked's default <RNMarkdown> export renders blocks inside a
  // FlatList. Chat messages are rendered inside app/session/[id].tsx's own
  // *inverted* FlatList (each row a MessageBubble) — nesting one
  // VirtualizedList inside another, especially an inverted one, is a known
  // React Native footgun where the inner list's content can fail to lay out
  // (renders zero height) instead of just warning. We already force
  // scrollEnabled: false and a large initialNumToRender here, which defeats
  // virtualization anyway, so there's nothing to lose by rendering the parsed
  // blocks directly with the useMarkdown hook instead (issue #104).
  const elements = useMarkdown(children ?? "", {
    renderer,
    styles: theme,
    colorScheme: isDark ? "dark" : "light",
  })

  if (!children?.trim()) return null

  // Parsed elements are final here, so the gallery list each tapped image
  // should page through is a pure function of them.
  const gallery = useMemo(() => collectImages(elements), [elements])

  return (
    <View style={{ backgroundColor: "transparent" }}>
      <GalleryContext.Provider value={gallery}>{elements}</GalleryContext.Provider>
    </View>
  )
}
