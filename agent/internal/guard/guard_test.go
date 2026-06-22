package guard

import "testing"

func TestScanDetectsSensitivePatterns(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		wantType string
	}{
		{"aws key", "key AKIA1234567890ABCDEF copied", "aws_access_key"},
		{"api key", "api_key = EXAMPLEKEY1234567890", "api_key"},
		{"jwt", "token eyJabc.eyJdef.signature", "jwt"},
		{"private key", "-----BEGIN RSA PRIVATE KEY-----", "private_key"},
		{"credit card", "card 4111 1111 1111 1111", "credit_card"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			findings := Scan(tt.text)
			if len(findings) == 0 {
				t.Fatal("expected finding")
			}
			if findings[0].Type != tt.wantType {
				t.Fatalf("expected type %q, got %q", tt.wantType, findings[0].Type)
			}
		})
	}
}

func TestScanIgnoresInvalidCreditCardCandidate(t *testing.T) {
	findings := Scan("card 4111 1111 1111 1112")
	if len(findings) != 0 {
		t.Fatalf("expected no findings, got %#v", findings)
	}
}
