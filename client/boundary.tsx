import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";

interface Props {
  name: string;
  report(message: string): void;
  color: string;
  children: ReactNode;
}

/** Shows render failures in the panel instead of a blank tab, and reports them to the plugin log. */
export class PanelBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.report(`${this.props.name} crashed: ${error.message}\n${(error.stack ?? "").slice(0, 800)}`);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 24 }}>
          <Text style={{ color: this.props.color }}>MDViewer failed: {this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}
