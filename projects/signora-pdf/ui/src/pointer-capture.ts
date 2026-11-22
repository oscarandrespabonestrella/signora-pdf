/**
 * Routes the rest of a pointer gesture to `element`, even if the pointer leaves
 * it. Capture is a progressive enhancement: it throws for pointers that are no
 * longer active and is missing in some test environments, and the gesture must
 * keep working without it.
 */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // The pointer is not active anymore; nothing to capture.
  }
}
