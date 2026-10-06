import type { ClientModule } from 'claude-code'

import type { BarMessage, BarProps } from './bar'

// One run of a label: uncolored parts take the line's own color, dim at rest and `hover` under the pointer.
export type LabelPart = { text: string; color?: string; bold?: boolean }

export type LabelProps = BarProps & { parts: LabelPart[]; isDim: boolean; hover: string }

// A fold line's label with colored parts; a Button label is one plain string, so a colored one is a Client that folds on click.
const Label: ClientModule<LabelProps, boolean> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(event => {
    const isOver = event.type !== 'leave'
    if (isOver !== (surface.state === true)) surface.setState(isOver)
    if (event.type === 'down' && event.button === 'left') surface.post({ type: 'fold', kind: props.kind, id: props.id } satisfies BarMessage)
  })
  const isOver = surface.state === true
  return (
    <Text wrap="truncate-end">
      {props.parts.map((part, n) => (
        <Text key={`part-${n}`} color={part.color ?? (isOver ? props.hover : undefined)} bold={part.bold} dimColor={!part.color && props.isDim && !isOver}>
          {part.text}
        </Text>
      ))}
    </Text>
  )
}

export default Label
