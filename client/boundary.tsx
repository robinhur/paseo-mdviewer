import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";

interface Props {
  name: string;
  /** Sends the failure to the plugin log. */
  report(message: string): void;
  /** Turns the error message into the text shown in the tab. */
  describe(message: string): string;
  color: string;
  children: ReactNode;
}

/** Shows a render failure in the tab instead of a blank panel, and reports it to the plugin log. */
export class PanelBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.report(`${this.props.name} failed: ${error.message}\n${(error.stack ?? "").slice(0, 800)}`);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 24 }}>
          <Text style={{ color: this.props.color }}>{this.props.describe(this.state.error.message)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}
