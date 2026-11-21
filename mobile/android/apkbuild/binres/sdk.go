// Copyright 2016 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
//
// Trimmed for Raven: the embedded framework table (arsc.go) is always used, so the
// Android SDK lookup is gone, and a target SDK version is added.

package binres

import "fmt"

// MinSDK is the lowest Android version the app installs on (5.0).
const MinSDK = 21

// TargetSDK is written into the manifest next to MinSDK.
const TargetSDK = 34

func apiResources() ([]byte, error) {
	return nil, fmt.Errorf("Android SDK lookup is not available in this build")
}
