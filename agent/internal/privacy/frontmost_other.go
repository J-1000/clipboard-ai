//go:build !darwin || ios

package privacy

func FrontmostApplication() Application { return Application{} }
