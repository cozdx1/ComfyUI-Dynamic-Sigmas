# Concat Sigmas

Joins connected sigma schedules in numeric input order.

Increase **input_count** to add inputs. Empty or unconnected inputs are ignored. The final value of every non-final connected schedule is removed so a shared boundary is not duplicated.

For example, `[1.0, 0.5]` followed by `[0.5, 0.0]` becomes `[1.0, 0.5, 0.0]`.

The node does not force adjacent boundary values to match. Check the endpoint of one schedule and the start of the next when a continuous curve is required.
