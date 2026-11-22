package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"io"
	"sort"
	"strings"
	"time"
)

// normalizeZip rewrites the APK the way Google's tools lay it out: every entry stored
// uncompressed with its CRC and sizes in the local header (no trailing data
// descriptors), and its data 4-byte aligned (so resources.arsc can be memory-mapped)
// using apksigner's alignment extra field (ID 0xD935) instead of raw zero padding.
// Entry contents are unchanged, so the v1 (JAR) signature stays valid.
func normalizeZip(in []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(in), int64(len(in)))
	if err != nil {
		return nil, err
	}
	// signature files first (as jarsigner and apksigner write them), then the manifest
	rank := func(n string) int {
		switch {
		case n == "META-INF/MANIFEST.MF":
			return 0
		case strings.HasPrefix(n, "META-INF/"):
			return 1
		case n == "AndroidManifest.xml":
			return 2
		}
		return 3
	}
	files := append([]*zip.File{}, zr.File...)
	sort.SliceStable(files, func(i, j int) bool { return rank(files[i].Name) < rank(files[j].Name) })
	stamp := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) // valid DOS date; the same in every build

	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range files {
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		// local header = 30 bytes + name + extra; align the data that follows
		const align = 4
		start := out.Len() + 30 + len(f.Name)
		pad := (align - (start+6)%align) % align // the extra record itself is 6 bytes + padding
		extra := make([]byte, 6+pad)
		binary.LittleEndian.PutUint16(extra[0:], 0xD935)
		binary.LittleEndian.PutUint16(extra[2:], uint16(2+pad))
		binary.LittleEndian.PutUint16(extra[4:], align)
		fh := &zip.FileHeader{
			Name:               f.Name,
			Method:             zip.Store,
			CRC32:              f.CRC32,
			CompressedSize64:   uint64(len(data)),
			UncompressedSize64: uint64(len(data)),
			Extra:              extra,
		}
		fh.SetModTime(stamp)
		w, err := zw.CreateRaw(fh)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(data); err != nil {
			return nil, err
		}
		if err := zw.Flush(); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
