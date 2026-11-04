import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#0D1117' },
  title: { color: '#E06C75', fontSize: 16, fontWeight: '700' },
  message: { color: '#8B949E', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  button: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#1C2128', borderColor: '#30363D', borderWidth: 1 },
  buttonText: { color: '#C9D1D9', fontSize: 13, fontWeight: '600' },
});

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </Text>
          <Text style={styles.message}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => this.setState({ hasError: false, error: null })}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
